import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import {
	createAnimeProgressPropertiesSchema,
	createCompletePropertiesSchema,
	createMangaProgressPropertiesSchema,
	createNoteAndRatingPropertiesSchema,
	createPodcastProgressPropertiesSchema,
	createProgressPercentPropertiesSchema,
	createReviewPropertiesSchema,
	createShowProgressPropertiesSchema,
	createWorkoutSetPropertiesSchema,
} from "~/lib/test-fixtures/property-schemas";
import type {
	CreateEventBody,
	EventServiceDeps,
	ListedEvent,
} from "~/modules/events";

const listedEventDefaults: ListedEvent = {
	id: "event_1",
	entityId: "entity_1",
	sessionEntityId: null,
	properties: { rating: 4 },
	eventSchemaSlug: "finished",
	eventSchemaName: "Finished",
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
	eventSchemaId: "event_schema_1",
};

const eventBodyDefaults: CreateEventBody = {
	entityId: "entity_1",
	eventSchemaId: "event_schema_1",
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
	entityUserId: "user_1",
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
	upsertInLibraryRelationship: async () => {},
	enqueueEventSchemaTriggerJob: async () => {},
	getUserLibraryEntityId: async () => "library_1",
	getActiveEventSchemaTriggersForEventSchemas: async () => [],
	listEventsByEntityForUser: async () => [createListedEvent()],
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entityUserId: input.userId,
		entitySchemaId: "schema_1",
		entitySchemaSlug: "custom",
	}),
	getSessionEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entityUserId: input.userId,
		entitySchemaId: "schema_1",
		entitySchemaSlug: "custom",
	}),
	getEventCreateScopeForUser: async (input) =>
		createEventCreateScope({
			entityId: input.entityId,
			eventSchemaId: input.eventSchemaId,
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						type: "number" as const,
						validation: { required: true as const },
					},
				},
			},
		}),
	createEventForUser: async (input) =>
		createListedEvent({
			entityId: input.entityId,
			properties: input.properties,
			eventSchemaId: input.eventSchemaId,
			eventSchemaName: input.eventSchemaName,
			eventSchemaSlug: input.eventSchemaSlug,
			sessionEntityId: input.sessionEntityId ?? null,
		}),
	...overrides,
});

export const createBuiltinBacklogEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "book",
				entityId: input.entityId,
				eventSchemaName: "Backlog",
				eventSchemaSlug: "backlog",
				propertiesSchema: { fields: {} },
				eventSchemaId: input.eventSchemaId,
			}),
		...overrides,
	});

export const createBuiltinProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "book",
				entityId: input.entityId,
				eventSchemaName: "Progress",
				eventSchemaSlug: "progress",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createProgressPercentPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinShowProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "show",
				entityId: input.entityId,
				eventSchemaName: "Progress",
				eventSchemaSlug: "progress",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createShowProgressPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinAnimeProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "anime",
				entityId: input.entityId,
				eventSchemaName: "Progress",
				eventSchemaSlug: "progress",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createAnimeProgressPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinMangaProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "manga",
				entityId: input.entityId,
				eventSchemaName: "Progress",
				eventSchemaSlug: "progress",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createMangaProgressPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinPodcastProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entityId: input.entityId,
				eventSchemaName: "Progress",
				eventSchemaSlug: "progress",
				entitySchemaSlug: "podcast",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createPodcastProgressPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinCompleteEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "book",
				entityId: input.entityId,
				eventSchemaName: "Complete",
				eventSchemaSlug: "complete",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createCompletePropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entitySchemaSlug: "book",
				entityId: input.entityId,
				eventSchemaName: "Review",
				eventSchemaSlug: "review",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createReviewPropertiesSchema(),
			}),
		...overrides,
	});

export const createBuiltinWorkoutSetEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: async (input) =>
			createEventCreateScope({
				isBuiltin: true,
				entityId: input.entityId,
				entitySchemaSlug: "exercise",
				eventSchemaName: "Workout Set",
				eventSchemaSlug: "workout-set",
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: createWorkoutSetPropertiesSchema(),
			}),
		...overrides,
	});
