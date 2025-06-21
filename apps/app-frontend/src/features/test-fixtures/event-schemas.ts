import type { AppEventSchema } from "#/features/event-schemas/model";

export function createEventSchemaFixture(
	overrides: Partial<AppEventSchema> = {},
): AppEventSchema {
	return {
		id: "schema-1",
		name: "Reading",
		slug: "reading",
		entitySchemaId: "entity-schema-1",
		propertiesSchema: {
			notes: { type: "string" },
			pages: { type: "integer", required: true },
		},
		...overrides,
	};
}
