import { defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../script-helpers/records";
import {
	extractDate,
	extractYear,
	readNextPage,
	readResults,
	readTotalItems,
	vndbPost,
} from "../../vndb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "VNDB",
	requiredAppConfigKeys: [],
	slug: "visual-novel.vndb",
	capabilities: ["httpCall"],
	providerInformation: { source: "vndb" },
});

const SEARCH_FIELDS = "title,image.url,released";
const DETAIL_FIELDS =
	"title,image.url,released,screenshots.url,developers.id,developers.name," +
	"length_minutes,tags.name,devstatus,description,rating";

const devstatusToString = (devstatus: unknown) => {
	if (devstatus === 0) {
		return "Finished";
	}
	if (devstatus === 1) {
		return "In development";
	}
	if (devstatus === 2) {
		return "Cancelled";
	}
	return null;
};

type Developer = { id: string; name: string };

const collectDevelopers = (developers: unknown): Developer[] => {
	const seen = new Set<string>();
	const result: Developer[] = [];
	for (const dev of Array.isArray(developers) ? developers : []) {
		const record = asRecord(dev);
		const id = stringValue(record?.["id"]);
		const name = stringValue(record?.["name"]);
		if (!id || !name || seen.has(id)) {
			continue;
		}
		seen.add(id);
		result.push({ id, name });
	}
	return result;
};

const imageUrl = (value: unknown) => stringValue(asRecord(value)?.["url"]);

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	vndbPost(
		host,
		"vn",
		{
			count: true,
			page: input.page,
			results: input.pageSize,
			fields: SEARCH_FIELDS,
			filters: ["search", "=", input.query],
		},
		"VNDB VN search request failed",
	).pipe(
		Effect.map((payload) => {
			const items = readResults(payload).flatMap((vn) => {
				const record = asRecord(vn);
				const externalId = stringValue(record?.["id"]);
				const name = stringValue(record?.["title"]);
				if (!externalId || !name) {
					return [];
				}
				const image = imageUrl(record?.["image"]);
				const publishYear = extractYear(record?.["released"]);
				return [
					{
						externalId,
						calloutProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: name },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
						imageProperty: image
							? { kind: "image" as const, value: { type: "remote" as const, url: image } }
							: { kind: "null" as const, value: null },
					},
				];
			});
			return {
				items,
				details: {
					totalItems: readTotalItems(payload),
					nextPage: readNextPage(payload, input.page),
				},
			};
		}),
	),
);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^v\d+$/.test(input.externalId)) {
		return Effect.fail(new Error("externalId must be a VNDB VN ID (e.g., 'v17')"));
	}
	return Effect.gen(function* () {
		const payload = yield* vndbPost(
			host,
			"vn",
			{ fields: DETAIL_FIELDS, filters: ["id", "=", input.externalId] },
			"VNDB VN details request failed",
		);
		const [first] = readResults(payload);
		const vn = asRecord(first);
		if (!vn) {
			return yield* Effect.fail(new Error("VNDB returned no data for this externalId"));
		}
		const name = stringValue(vn["title"]);
		if (!name) {
			return yield* Effect.fail(new Error("VNDB VN payload is missing title"));
		}

		const images: Array<{ type: "remote"; url: string }> = [];
		const cover = imageUrl(vn["image"]);
		if (cover) {
			images.push({ type: "remote", url: cover });
		}
		for (const shot of Array.isArray(vn["screenshots"]) ? vn["screenshots"] : []) {
			const url = imageUrl(shot);
			if (url && !images.some((image) => image.url === url)) {
				images.push({ type: "remote", url });
			}
		}

		const genres = (Array.isArray(vn["tags"]) ? vn["tags"] : []).flatMap((tag) => {
			const tagName = stringValue(asRecord(tag)?.["name"]);
			return tagName ? [tagName] : [];
		});

		const relatedEntities = collectDevelopers(vn["developers"]).map((dev) => ({
			name: dev.name,
			externalId: dev.id,
			scriptSlug: "company.vndb",
			relationshipProperties: { roles: ["Developer"] },
		}));

		const lengthMinutesValue = numberValue(vn["length_minutes"]);
		const lengthMinutes =
			lengthMinutesValue !== null && lengthMinutesValue > 0 ? Math.trunc(lengthMinutesValue) : null;

		return {
			name,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					entities: relatedEntities,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "company-to-visual-novel",
				},
			],
			properties: {
				images,
				genres,
				lengthMinutes,
				publishDate: extractDate(vn["released"]),
				publishYear: extractYear(vn["released"]),
				providerRating: numberValue(vn["rating"]),
				description: stringValue(vn["description"]),
				sourceUrl: `https://vndb.org/${input.externalId}`,
				productionStatus: devstatusToString(vn["devstatus"]),
			},
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
