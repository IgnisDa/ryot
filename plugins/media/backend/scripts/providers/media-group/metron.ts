import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../shared/records";
import { loadMetronJson, type MetronHost } from "../metron-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron",
	slug: "comic-book-group.metron",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["metronUsername", "metronPassword"],
	requiredSystemConfigKeys: [],
});

const METRON_BASE_URL = "https://metron.cloud/api";

type OrderedRelatedEntity = {
	name: string;
	externalId: string;
	providerSlug: string;
	relationshipProperties: { order: number };
};

const numericIdString = (value: unknown) =>
	typeof value === "number" ? String(Math.trunc(value)) : null;

const metronGet = (host: MetronHost, path: string) =>
	loadMetronJson(host, `${METRON_BASE_URL}${path}`, `Metron request failed: ${path}`);

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const params = new URLSearchParams({
			name: input.query,
			page: String(input.page),
			page_size: String(input.pageSize),
		});
		return metronGet(host, `/series/?${params.toString()}`).pipe(
			Effect.map((dataValue) => {
				const data = asRecord(dataValue);
				const resultsValue = data?.["results"];
				const results = Array.isArray(resultsValue) ? resultsValue : [];
				const countValue = data?.["count"];
				const totalItems = typeof countValue === "number" ? countValue : results.length;
				const items = results.flatMap((series) => {
					const record = asRecord(series);
					const id = numericIdString(record?.["id"]);
					const name = stringValue(record?.["name"]);
					if (!record || !id || !name) {
						return [];
					}
					const issueCount = record["issue_count"];
					const parts = typeof issueCount === "number" ? issueCount : null;
					return [
						{
							title: name,
							externalId: id,
							...(parts === null ? {} : { metadata: [parts] as const }),
						},
					];
				});
				const nextPage = data?.["next"] != null ? input.page + 1 : null;
				return { items, details: { totalItems, nextPage } };
			}),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric Metron series ID"));
			}
			const seriesValue = yield* metronGet(host, `/series/${input.externalId}/`);
			const series = asRecord(seriesValue);
			const title = stringValue(series?.["name"]);
			if (!title) {
				return yield* Effect.fail(new Error("Metron series is missing name"));
			}
			const description = stringValue(series?.["desc"]);
			const issueCount = series?.["issue_count"];
			const parts = typeof issueCount === "number" ? issueCount : 0;
			const issueListValue = yield* metronGet(
				host,
				`/series/${input.externalId}/issue_list/?limit=100`,
			);
			const issueListResults = asRecord(issueListValue)?.["results"];
			const issueList = Array.isArray(issueListResults) ? issueListResults : [];
			const relatedEntities = issueList.flatMap((issue, idx): OrderedRelatedEntity[] => {
				const record = asRecord(issue);
				const memberId = numericIdString(record?.["id"]);
				if (!memberId) {
					return [];
				}
				const memberName =
					stringValue(record?.["issue"]) ?? stringValue(record?.["issue_name"]) ?? "Loading...";
				return [
					{
						name: memberName,
						externalId: memberId,
						providerSlug: "comic-book.metron",
						relationshipProperties: { order: idx + 1 },
					},
				];
			});
			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						entities: relatedEntities,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "comic-book-group-to-comic-book",
					},
				],
				properties: {
					parts,
					images: [],
					description,
					sourceUrl: `https://metron.cloud/series/${input.externalId}`,
				},
			};
		}),
});
