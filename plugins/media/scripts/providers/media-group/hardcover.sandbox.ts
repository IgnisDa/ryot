import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../script-helpers/records";
import {
	escapeGraphqlString,
	getHardcoverApiKey,
	hardcoverGql,
	idValue,
} from "../hardcover-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover",
	slug: "book-group.hardcover",
	providerInformation: { source: "hardcover" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.hardcoverApiKey"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	Effect.gen(function* () {
		const apiKey = yield* getHardcoverApiKey(host);
		const graphqlQuery = `
query {
  search(
    page: ${input.page},
    per_page: ${input.pageSize},
    query: "${escapeGraphqlString(input.query)}",
    query_type: "series"
  ) {
    results
  }
}
`;
		const payloadValue = yield* hardcoverGql(
			host,
			{ query: graphqlQuery },
			apiKey,
			"Hardcover GraphQL request failed",
		);
		const payload = asRecord(payloadValue);
		const resultsData = asRecord(asRecord(asRecord(payload?.["data"])?.["search"])?.["results"]);
		if (!resultsData) {
			return yield* Effect.fail(new Error("Hardcover returned invalid response structure"));
		}
		const found = numberValue(resultsData["found"]);
		const totalItems = found === null ? 0 : Math.max(0, Math.trunc(found));
		const hits = resultsData["hits"];
		const items = (Array.isArray(hits) ? hits : []).flatMap((hit) => {
			const doc = asRecord(asRecord(hit)?.["document"]);
			const externalId = idValue(doc?.["id"]);
			const name = stringValue(doc?.["name"]);
			if (!externalId || !name) {
				return [];
			}
			const parts = numberValue(doc?.["books_count"]);
			const image = stringValue(asRecord(doc?.["image"])?.["url"]);
			return [
				{
					externalId,
					titleProperty: { kind: "text" as const, value: name },
					calloutProperty: { kind: "null" as const, value: null },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					imageProperty: image
						? { kind: "image" as const, value: { type: "remote" as const, url: image } }
						: { kind: "null" as const, value: null },
					primarySubtitleProperty:
						parts === null
							? { kind: "null" as const, value: null }
							: { kind: "number" as const, value: parts },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	}),
);

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		const graphqlQuery = `
{
  series_by_pk(id: ${input.externalId}) {
    id
    name
    slug
    books_count
    description
    book_series(
      order_by: { position: asc }
      where: {
        book: {
          book_status_id: { _eq: "1" }, compilation: { _eq: false },
          default_physical_edition: { language_id: { _eq: 1 } }
        }
      }
    ) {
      book { id title }
    }
  }
}
`;
		const apiKey = yield* getHardcoverApiKey(host);
		const payloadValue = yield* hardcoverGql(
			host,
			{ query: graphqlQuery },
			apiKey,
			"Hardcover GraphQL request failed",
		);
		const data = asRecord(asRecord(asRecord(payloadValue)?.["data"])?.["series_by_pk"]);
		if (!data) {
			return yield* Effect.fail(new Error("Hardcover returned no series data"));
		}
		const title = stringValue(data["name"]);
		if (!title) {
			return yield* Effect.fail(new Error("Hardcover series is missing name"));
		}
		const bookSeries = data["book_series"];
		const relatedEntities = (Array.isArray(bookSeries) ? bookSeries : []).flatMap((entry, idx) => {
			const book = asRecord(asRecord(entry)?.["book"]);
			const memberId = idValue(book?.["id"]);
			if (!memberId) {
				return [];
			}
			return [
				{
					externalId: memberId,
					scriptSlug: "book.hardcover",
					relationshipProperties: { order: idx + 1 },
					name: stringValue(book?.["title"]) ?? "Loading...",
				},
			];
		});
		const slug = stringValue(data["slug"]);
		return {
			name: title,
			properties: {
				images: [],
				parts: numberValue(data["books_count"]),
				description: stringValue(data["description"]),
				sourceUrl: slug ? `https://hardcover.app/series/${slug}` : null,
			},
			relatedEntityGroups: [
				{
					entities: relatedEntities,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "book-group-to-book",
				},
			],
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
