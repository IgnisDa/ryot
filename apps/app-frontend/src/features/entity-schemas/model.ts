import type { AppSchema } from "@ryot/ts-utils";
import type { AppFacet } from "#/features/facets/model";

export interface AppEntitySchema {
	id: string;
	icon: string;
	name: string;
	slug: string;
	facetId: string;
	isBuiltin: boolean;
	accentColor: string;
	propertiesSchema: AppSchema;
}

export function sortEntitySchemas(
	entitySchemas: AppEntitySchema[],
): AppEntitySchema[] {
	return [...entitySchemas].sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.slug.localeCompare(b.slug);
	});
}

type FacetEntitySchemaViewState =
	| { type: "builtin" }
	| { type: "empty" }
	| { type: "list"; entitySchemas: AppEntitySchema[] };

export function getFacetEntitySchemaViewState(input: {
	facet: AppFacet;
	entitySchemas: AppEntitySchema[];
}): FacetEntitySchemaViewState {
	if (input.facet.isBuiltin) return { type: "builtin" };
	if (input.entitySchemas.length === 0) return { type: "empty" };

	return {
		type: "list",
		entitySchemas: sortEntitySchemas(input.entitySchemas),
	};
}
