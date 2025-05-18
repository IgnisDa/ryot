import type { AppEvent } from "#/features/events/model";

export function createEventFixture(
	overrides: Partial<AppEvent> = {},
): AppEvent {
	return {
		id: "event-1",
		properties: {},
		entityId: "entity-1",
		eventSchemaId: "schema-1",
		eventSchemaName: "Logged",
		eventSchemaSlug: "logged",
		createdAt: new Date("2026-03-08T10:15:00.000Z"),
		updatedAt: new Date("2026-03-08T10:20:00.000Z"),
		...overrides,
	};
}
