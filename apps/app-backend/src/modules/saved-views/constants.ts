import type { DisplayConfiguration, SavedViewQueryDefinition } from "./schemas";

export const buildEntityFieldReference = (
	schemaSlug: string,
	field: string,
) => {
	return `entity.${schemaSlug}.${field}`;
};

export const createDefaultDisplayConfiguration = (
	entitySchemaSlug?: string,
): DisplayConfiguration => ({
	table: {
		columns: entitySchemaSlug
			? [
					{
						label: "Name",
						property: [buildEntityFieldReference(entitySchemaSlug, "@name")],
					},
				]
			: [],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? [buildEntityFieldReference(entitySchemaSlug, "@name")]
			: null,
		imageProperty: entitySchemaSlug
			? [buildEntityFieldReference(entitySchemaSlug, "@image")]
			: null,
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? [buildEntityFieldReference(entitySchemaSlug, "@name")]
			: null,
		imageProperty: entitySchemaSlug
			? [buildEntityFieldReference(entitySchemaSlug, "@image")]
			: null,
	},
});

export const createDefaultQueryDefinition = (
	entitySchemaSlugs: string[],
): SavedViewQueryDefinition => ({
	filters: [],
	eventJoins: [],
	entitySchemaSlugs,
	sort: {
		direction: "asc",
		fields: entitySchemaSlugs[0]
			? [buildEntityFieldReference(entitySchemaSlugs[0], "@name")]
			: [],
	},
});
