import type { AppEntitySchema } from "#/features/entity-schemas/model";

export function createEntitySchemaFixture(
	overrides: Partial<AppEntitySchema> = {},
): AppEntitySchema {
	return {
		name: "Schema",
		slug: "schema",
		id: "schema-id",
		isBuiltin: false,
		icon: "book-open",
		searchProviders: [],
		propertiesSchema: {},
		accentColor: "#5B7FFF",
		trackerId: "tracker-id",
		...overrides,
	};
}
