import { resolveRequiredString } from "@ryot/ts-utils";
import type { FacetMode } from "~/lib/db/schema";
import type { SavedViewQueryDefinition } from "../saved-views/schemas";

export const resolveAuthenticationName = (name: string) =>
	resolveRequiredString(name, "Signup name");

export const buildAuthenticationFacetInputs = (input: {
	facets: Array<{
		slug: string;
		icon: string;
		name: string;
		mode: FacetMode;
		accentColor: string;
		description?: string;
	}>;
}) => {
	return input.facets.map((facet) => ({
		slug: facet.slug,
		name: facet.name,
		icon: facet.icon,
		mode: facet.mode,
		accentColor: facet.accentColor,
		description: facet.description,
	}));
};

export const buildAuthenticationFacetEntitySchemaLinks = (input: {
	facets: Array<{ id: string; slug: string }>;
	entitySchemas: Array<{ id: string; slug: string }>;
	schemaLinks: Array<{ slug: string; facetSlug: string }>;
}) => {
	return input.schemaLinks.map((schemaLink) => {
		const facet = input.facets.find(
			(item) => item.slug === schemaLink.facetSlug,
		);
		const entitySchema = input.entitySchemas.find(
			(item) => item.slug === schemaLink.slug,
		);

		if (!facet)
			throw new Error(
				`Missing built-in facet for entity schema ${schemaLink.slug}`,
			);

		if (!entitySchema)
			throw new Error(
				`Missing built-in entity schema for facet link ${schemaLink.slug}`,
			);

		return {
			facetId: facet.id,
			entitySchemaId: entitySchema.id,
		};
	});
};

export const buildAuthenticationSavedViewInputs = (input: {
	entitySchemas: Array<{ id: string; slug: string }>;
	savedViews: Array<{ name: string; entitySchemaSlug: string }>;
}) => {
	return input.savedViews.map((savedView) => {
		const entitySchema = input.entitySchemas.find(
			(schema) => schema.slug === savedView.entitySchemaSlug,
		);

		if (!entitySchema)
			throw new Error(
				`Missing built-in entity schema for saved view ${savedView.name}`,
			);

		return {
			isBuiltin: true,
			name: savedView.name,
			queryDefinition: {
				entitySchemaIds: [entitySchema.id],
			} satisfies SavedViewQueryDefinition,
		};
	});
};
