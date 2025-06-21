import type { ViewExpression } from "~/lib/views/expression";
import type { DisplayConfiguration, SavedViewQueryDefinition } from "./schemas";

export const buildEntityColumnExpression = (
	schemaSlug: string,
	column: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity-column", slug: schemaSlug, column },
});

export const createDefaultDisplayConfiguration = (
	entitySchemaSlug?: string,
): DisplayConfiguration => ({
	table: {
		columns: entitySchemaSlug
			? [
					{
						label: "Name",
						expression: buildEntityColumnExpression(entitySchemaSlug, "name"),
					},
				]
			: [],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "name")
			: null,
		imageProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "image")
			: null,
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "name")
			: null,
		imageProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "image")
			: null,
	},
});

export const createDefaultQueryDefinition = (
	entitySchemaSlugs: string[],
): SavedViewQueryDefinition => ({
	filter: null,
	eventJoins: [],
	entitySchemaSlugs,
	sort: {
		direction: "asc",
		expression: entitySchemaSlugs[0]
			? buildEntityColumnExpression(entitySchemaSlugs[0], "name")
			: { type: "literal", value: "" },
	},
});
