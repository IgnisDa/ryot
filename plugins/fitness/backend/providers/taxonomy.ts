import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type {
	ProviderDetailsInput,
	ProviderResolveInput,
	ProviderSearchInput,
} from "@ryot-app/sandbox-sdk/provider";

import type { exerciseEquipmentCatalog, exerciseTargetCatalog } from "../../shared/taxonomy";

type TaxonomyEntry =
	| (typeof exerciseEquipmentCatalog)[number]
	| (typeof exerciseTargetCatalog)[number];

class FitnessTaxonomyError extends Error {
	readonly _tag = "FitnessTaxonomyError";
}

const normalizeIdentifier = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

export const searchTaxonomyCatalog = (
	input: ProviderSearchInput,
	catalog: readonly TaxonomyEntry[],
) => {
	const query = input.query.trim().toLowerCase();
	const matches = catalog.filter(
		(entry) =>
			entry.name.toLowerCase().includes(query) || entry.externalId.toLowerCase().includes(query),
	);
	const pageStart = (input.page - 1) * input.pageSize;
	const pageEntries = matches.slice(pageStart, pageStart + input.pageSize);

	return Effect.succeed({
		items: pageEntries.map(({ name, externalId }) => ({ externalId, title: name })),
		details: {
			totalItems: matches.length,
			nextPage: pageStart + pageEntries.length < matches.length ? input.page + 1 : null,
		},
	});
};

export const getTaxonomyDetails = (
	input: ProviderDetailsInput,
	catalog: readonly TaxonomyEntry[],
) => {
	const entry = catalog.find(({ externalId }) => externalId === input.externalId);
	return entry
		? Effect.succeed({ name: entry.name, properties: entry.properties })
		: Effect.fail(new FitnessTaxonomyError(`Taxonomy entry not found: ${input.externalId}`));
};

export const resolveTaxonomyEntry = (
	input: ProviderResolveInput,
	catalog: readonly TaxonomyEntry[],
) => {
	const value = normalizeIdentifier(input.value);
	const matches = catalog.filter((entry) => {
		if (input.identifierType === "name") {
			return normalizeIdentifier(entry.name) === value;
		}
		if (input.identifierType === "external-id") {
			return normalizeIdentifier(entry.externalId) === value;
		}
		return false;
	});

	return Effect.succeed({
		externalId: matches.length === 1 ? (matches[0]?.externalId ?? null) : null,
	});
};
