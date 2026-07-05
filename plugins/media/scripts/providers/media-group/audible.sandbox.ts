import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import { audibleFetchJson } from "../audible-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible",
	slug: "audiobook-group.audible",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
	providerInformation: { source: "audible" },
});

const CATALOG_URL = "https://api.audible.com/1.0/catalog/products";

export const search = defineProviderDriver(manifest, "search", () =>
	Effect.fail(new Error("Audible does not support audiobook group search")),
);

const sortValue = (relationship: unknown) => {
	const sort = asRecord(relationship)?.["sort"];
	return typeof sort === "string" ? Number.parseInt(sort, 10) : 0;
};

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		const params = new URLSearchParams({
			response_groups: "media,product_attrs,relationships",
		});
		const payloadValue = yield* audibleFetchJson(
			host,
			`${CATALOG_URL}/${input.externalId}?${params.toString()}`,
			"Audible series request failed",
			"Audible",
		);
		const product = asRecord(asRecord(payloadValue)?.["product"]);
		if (!product) {
			return yield* Effect.fail(new Error("Audible returned no product data for this series"));
		}
		const title = stringValue(product["title"]);
		if (!title) {
			return yield* Effect.fail(new Error("Audible series product is missing title"));
		}

		const rawRelationships = product["relationships"];
		const sortedAsins = (Array.isArray(rawRelationships) ? rawRelationships : [])
			.filter((relationship) => typeof asRecord(relationship)?.["asin"] === "string")
			.sort((first, second) => sortValue(first) - sortValue(second))
			.flatMap((relationship) => {
				const asin = stringValue(asRecord(relationship)?.["asin"]);
				return asin ? [asin] : [];
			});

		const relatedEntities = sortedAsins.map((asin, idx) => ({
			externalId: asin,
			name: "Loading...",
			scriptSlug: "audiobook.audible",
			relationshipProperties: { order: idx + 1 },
		}));

		return {
			name: title,
			relatedEntityGroups: [
				{
					entities: relatedEntities,
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "audiobook-group-to-audiobook",
				},
			],
			properties: {
				images: [],
				description: null,
				parts: sortedAsins.length,
				sourceUrl: `https://www.audible.com/series/${input.externalId}/${title}`,
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
