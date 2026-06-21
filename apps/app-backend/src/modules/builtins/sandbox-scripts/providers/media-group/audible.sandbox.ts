import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, audibleFetchJson, stringValue } from "../audible-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible",
	slug: "audiobook-group.audible",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
	providerInformation: { source: "audible" },
});

const CATALOG_URL = "https://api.audible.com/1.0/catalog/products";

export const search = defineProviderDriver(manifest, "search", () => {
	throw new Error("Audible does not support audiobook group search");
});

const sortValue = (relationship: unknown) => {
	const sort = asRecord(relationship)?.["sort"];
	return typeof sort === "string" ? Number.parseInt(sort, 10) : 0;
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const params = new URLSearchParams({
		response_groups: "media,product_attrs,relationships",
	});
	return audibleFetchJson(
		host,
		`${CATALOG_URL}/${input.externalId}?${params.toString()}`,
		"Audible series request failed",
		"Audible",
	).then((payloadValue) => {
		const product = asRecord(asRecord(payloadValue)?.["product"]);
		if (!product) {
			throw new Error("Audible returned no product data for this series");
		}
		const title = stringValue(product["title"]);
		if (!title) {
			throw new Error("Audible series product is missing title");
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
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
