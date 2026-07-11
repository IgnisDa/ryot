import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import type { RoleRelatedEntity } from "../../script-helpers/role-accumulator";
import {
	combineDescription,
	extractGiantBombGuid,
	extractYear,
	getPrioritizedImage,
	GUID_PATTERN,
	giantBombRequest,
	imageProperty,
	paginate,
	readResults,
	readTotalItems,
} from "../giant-bomb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb",
	slug: "person.giant-bomb",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
	requiredSystemConfigKeys: [],
});

const lastNonEmptySegment = (value: unknown) => {
	const apiUrl = typeof value === "string" ? value : "";
	let lastSegment: string | null = null;
	for (const segment of apiUrl.split("/")) {
		if (segment.length > 0) {
			lastSegment = segment;
		}
	}
	return lastSegment;
};

const formatBirthDate = (dateStr: unknown) => {
	const value = stringValue(dateStr);
	if (!value) {
		return null;
	}
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
	if (!match) {
		return null;
	}
	const year = Number.parseInt(match[1] ?? "", 10);
	const month = Number.parseInt(match[2] ?? "", 10);
	const day = Number.parseInt(match[3] ?? "", 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		giantBombRequest(
			host,
			"search/",
			{
				query: input.query,
				resources: "person",
				limit: String(input.pageSize),
				offset: String((input.page - 1) * input.pageSize),
			},
			"GiantBomb person search request failed",
		).pipe(
			Effect.map((payload) => {
				const items = readResults(payload).flatMap((person) => {
					const record = asRecord(person);
					if (!record) {
						return [];
					}
					const guid = stringValue(record["guid"]);
					if (!guid) {
						const fallback = lastNonEmptySegment(record["api_detail_url"]);
						if (!fallback || !GUID_PATTERN.test(fallback)) {
							return [];
						}
					}
					const name = stringValue(record["name"]);
					if (!name) {
						return [];
					}
					const externalId = guid ?? lastNonEmptySegment(record["api_detail_url"]) ?? "";
					const birthYear = extractYear(record["birth_date"]);
					return [
						{
							externalId,
							calloutProperty: { kind: "null" as const, value: null },
							titleProperty: { kind: "text" as const, value: name },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty: imageProperty(getPrioritizedImage(record["image"])),
							primarySubtitleProperty:
								birthYear === null
									? { kind: "null" as const, value: null }
									: { kind: "number" as const, value: birthYear },
						},
					];
				});
				return { items, details: paginate(input.page, input.pageSize, readTotalItems(payload)) };
			}),
		),
});

const FIELD_LIST = [
	"id",
	"guid",
	"name",
	"deck",
	"description",
	"birth_date",
	"date_of_birth",
	"death_date",
	"hometown",
	"image",
	"site_detail_url",
	"franchises",
	"games.guid",
	"games.name",
	"games.api_detail_url",
].join(",");

const collectRelated = (items: unknown, providerSlug: string): RoleRelatedEntity[] => {
	if (!Array.isArray(items)) {
		return [];
	}
	return items.flatMap((item) => {
		const record = asRecord(item);
		const apiDetailUrl = record?.["api_detail_url"];
		if (typeof apiDetailUrl !== "string" || !apiDetailUrl) {
			return [];
		}
		const externalId = extractGiantBombGuid(apiDetailUrl);
		const name = stringValue(record["name"]);
		if (!externalId || !name) {
			return [];
		}
		return [{ name, externalId, providerSlug, relationshipProperties: { roles: ["Person"] } }];
	});
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!GUID_PATTERN.test(input.externalId)) {
			throw new Error("externalId must be a GiantBomb GUID (e.g., '4010-1')");
		}
		return giantBombRequest(
			host,
			`person/${encodeURIComponent(input.externalId)}/`,
			{ field_list: FIELD_LIST },
			"GiantBomb person details request failed",
		).pipe(
			Effect.map((payload) => {
				const person = asRecord(payload?.["results"]);
				if (!person) {
					throw new Error("GiantBomb returned no person data");
				}
				const name = stringValue(person["name"]);
				if (!name) {
					throw new Error("GiantBomb person payload is missing name");
				}

				const primaryImage = getPrioritizedImage(person["image"]);
				const hometown = stringValue(person["hometown"]);

				return {
					name,
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-video-game",
							entities: collectRelated(person["games"], "video-game.giant-bomb"),
						},
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "person-to-video-game-group",
							entities: collectRelated(person["franchises"], "video-game-group.giant-bomb"),
						},
					],
					properties: {
						alternateNames: [],
						birthPlace: hometown,
						deathDate: formatBirthDate(person["death_date"]),
						sourceUrl: stringValue(person["site_detail_url"]),
						birthDate: formatBirthDate(person["birth_date"] ?? person["date_of_birth"]),
						images: primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [],
						description: combineDescription(person["deck"], person["description"]),
					},
				};
			}),
		);
	},
});
