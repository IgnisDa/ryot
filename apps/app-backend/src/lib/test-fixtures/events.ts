import {
	createCreatedAt,
	createOccurredAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import { createNoteAndRatingPropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type { CreateEventBody, ListedEvent } from "~/modules/events/schemas";
import type { EventServiceDeps } from "~/modules/events/service";

const listedEventDefaults: ListedEvent = {
	id: "event_1",
	entityId: "entity_1",
	properties: { rating: 4 },
	eventSchemaSlug: "finished",
	eventSchemaName: "Finished",
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
	occurredAt: createOccurredAt(),
	eventSchemaId: "event_schema_1",
};

const eventBodyDefaults: CreateEventBody = {
	entityId: "entity_1",
	eventSchemaId: "event_schema_1",
	occurredAt: "2026-03-08T10:15:00.000Z",
	properties: { rating: 4 },
};

type EventCreateScope = NonNullable<
	Awaited<ReturnType<EventServiceDeps["getEventCreateScopeForUser"]>>
>;

export const createEventBody = (
	overrides: Partial<CreateEventBody> = {},
): CreateEventBody => withOverrides(eventBodyDefaults, overrides);

export const createListedEvent = (
	overrides: Partial<ListedEvent> = {},
): ListedEvent => withOverrides(listedEventDefaults, overrides);

export const createEventCreateScope = (
	overrides: Partial<EventCreateScope> = {},
): EventCreateScope => ({
	isBuiltin: false,
	entityId: "entity_1",
	entitySchemaSlug: "custom",
	entitySchemaId: "schema_1",
	eventSchemaSlug: "finished",
	eventSchemaName: "Finished",
	eventSchemaId: "event_schema_1",
	eventSchemaEntitySchemaId: "schema_1",
	propertiesSchema: createNoteAndRatingPropertiesSchema(),
	...overrides,
});

export const createEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps => ({
	listEventsByEntityForUser: async () => [createListedEvent()],
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entitySchemaSlug: "custom",
		entitySchemaId: "schema_1",
	}),
	getEventCreateScopeForUser: async (input) =>
		createEventCreateScope({
			entityId: input.entityId,
			eventSchemaId: input.eventSchemaId,
			propertiesSchema: { rating: { type: "number" as const, required: true } },
		}),
	createEventForUser: async (input) =>
		createListedEvent({
			entityId: input.entityId,
			occurredAt: input.occurredAt,
			properties: input.properties,
			eventSchemaId: input.eventSchemaId,
			eventSchemaName: input.eventSchemaName,
			eventSchemaSlug: input.eventSchemaSlug,
		}),
	...overrides,
});
