import type { AppEventSchema } from "~/features/event-schemas/model";

export function createEventSchemaFixture(overrides: Partial<AppEventSchema> = {}): AppEventSchema {
	return {
		id: "schema-1",
		name: "Reading",
		slug: "reading",
		entitySchemaId: "entity-schema-1",
		propertiesSchema: {
			fields: {
				notes: { label: "Notes", description: "Notes", type: "string" },
				pages: {
					label: "Pages",
					description: "Pages",
					type: "integer",
					validation: { required: true },
				},
			},
		},
		...overrides,
	};
}
