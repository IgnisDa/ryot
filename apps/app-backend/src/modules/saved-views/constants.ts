import type { ViewExpression } from "~/lib/views/expression";
import type { DisplayConfiguration, SavedViewQueryDefinition } from "./schemas";

export const buildEntityReferenceExpression = (
	schemaSlug: string,
	field: string,
): ViewExpression => {
	return {
		type: "reference",
		reference: field.startsWith("@")
			? { type: "entity-column", slug: schemaSlug, column: field.slice(1) }
			: { type: "schema-property", slug: schemaSlug, property: field },
	};
};

export const createDefaultDisplayConfiguration = (
	entitySchemaSlug?: string,
): DisplayConfiguration => ({
	table: {
		columns: entitySchemaSlug
			? [
					{
						label: "Name",
						expression: buildEntityReferenceExpression(
							entitySchemaSlug,
							"@name",
						),
					},
				]
			: [],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? buildEntityReferenceExpression(entitySchemaSlug, "@name")
			: null,
		imageProperty: entitySchemaSlug
			? buildEntityReferenceExpression(entitySchemaSlug, "@image")
			: null,
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: entitySchemaSlug
			? buildEntityReferenceExpression(entitySchemaSlug, "@name")
			: null,
		imageProperty: entitySchemaSlug
			? buildEntityReferenceExpression(entitySchemaSlug, "@image")
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
			? buildEntityReferenceExpression(entitySchemaSlugs[0], "@name")
			: { type: "literal", value: "" },
	},
});
