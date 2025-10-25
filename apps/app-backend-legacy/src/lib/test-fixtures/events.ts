import {
	createCreatedAt,
	createOccurredAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import {
	createAnimeProgressPropertiesSchema,
	createAnimeReviewPropertiesSchema,
	createCompletePropertiesSchema,
	createMangaProgressPropertiesSchema,
	createMangaReviewPropertiesSchema,
	createNoteAndRatingPropertiesSchema,
	createPodcastProgressPropertiesSchema,
	createPodcastReviewPropertiesSchema,
	createProgressPercentPropertiesSchema,
	createReviewPropertiesSchema,
	createShowProgressPropertiesSchema,
	createShowReviewPropertiesSchema,
	createWorkoutSetPropertiesSchema,
} from "~/lib/test-fixtures/property-schemas";
import type { CreateEventBody, ListedEvent } from "~/modules/events";
import type { EventServiceDeps } from "~/modules/events/service";

const listedEventDefaults: ListedEvent = {
	id: "event_1",
	entityId: "entity_1",
	sessionEntityId: null,
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
	properties: { rating: 4 },
	eventSchemaId: "event_schema_1",
};

type EventCreateScope = NonNullable<
	Awaited<ReturnType<EventServiceDeps["getEventCreateScopeForUser"]>>
>;

export const createEventBody = (overrides: Partial<CreateEventBody> = {}): CreateEventBody =>
	withOverrides(eventBodyDefaults, overrides);

export const createListedEvent = (overrides: Partial<ListedEvent> = {}): ListedEvent =>
	withOverrides(listedEventDefaults, overrides);

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

export const createEventDeps = (overrides: Partial<EventServiceDeps> = {}): EventServiceDeps => ({
	enqueueEventSchemaTriggerJob: () => Promise.resolve(),
	getActiveEventSchemaTriggersForEventSchemas: () => Promise.resolve([]),
	getActiveBeforeCreateTriggersForEventSchemas: () => Promise.resolve([]),
	listEventsByEntityForUser: () => Promise.resolve([createListedEvent()]),
	runBeforeCreateTrigger: () => Promise.resolve({ outcome: "result", result: { action: "allow" } }),
	getEntityScopeForUser: (input) =>
		Promise.resolve({
			isBuiltin: false,
			entityId: input.entityId,
			entityUserId: input.userId,
			entitySchemaId: "schema_1",
			entitySchemaSlug: "custom",
		}),
	getSessionEntityScopeForUser: (input) =>
		Promise.resolve({
			isBuiltin: false,
			entityId: input.entityId,
			entityUserId: input.userId,
			entitySchemaId: "schema_1",
			entitySchemaSlug: "custom",
		}),
	getEventSchemaForEntityBySlug: (_input) =>
		Promise.resolve({
			entityUserId: "user_1",
			eventSchemaName: "Event",
			entitySchemaId: "schema_1",
			entitySchemaSlug: "custom",
			eventSchemaId: "event_schema_1",
			propertiesSchema: { fields: {} },
			eventSchemaEntitySchemaId: "schema_1",
		}),
	getEventCreateScopeForUser: (input) =>
		Promise.resolve(
			createEventCreateScope({
				entityId: input.entityId,
				eventSchemaId: input.eventSchemaId,
				propertiesSchema: {
					fields: {
						rating: {
							label: "Rating",
							type: "number" as const,
							description: "Rating score",
							validation: { required: true as const },
						},
					},
				},
			}),
		),
	createEventForUser: (input) =>
		Promise.resolve(
			createListedEvent({
				entityId: input.entityId,
				occurredAt: input.occurredAt,
				properties: input.properties,
				eventSchemaId: input.eventSchemaId,
				eventSchemaName: input.eventSchemaName,
				eventSchemaSlug: input.eventSchemaSlug,
				sessionEntityId: input.sessionEntityId ?? null,
			}),
		),
	...overrides,
});

export const createBuiltinBacklogEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "book",
					entityId: input.entityId,
					eventSchemaName: "Backlog",
					eventSchemaSlug: "backlog",
					propertiesSchema: { fields: {} },
					eventSchemaId: input.eventSchemaId,
				}),
			),
		...overrides,
	});

export const createBuiltinProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "book",
					entityId: input.entityId,
					eventSchemaName: "Progress",
					eventSchemaSlug: "progress",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createProgressPercentPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinShowProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "show",
					entityId: input.entityId,
					eventSchemaName: "Progress",
					eventSchemaSlug: "progress",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createShowProgressPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinAnimeProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "anime",
					entityId: input.entityId,
					eventSchemaName: "Progress",
					eventSchemaSlug: "progress",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createAnimeProgressPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinMangaProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "manga",
					entityId: input.entityId,
					eventSchemaName: "Progress",
					eventSchemaSlug: "progress",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createMangaProgressPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinPodcastProgressEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entityId: input.entityId,
					eventSchemaName: "Progress",
					eventSchemaSlug: "progress",
					entitySchemaSlug: "podcast",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createPodcastProgressPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinCompleteEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "book",
					entityId: input.entityId,
					eventSchemaName: "Complete",
					eventSchemaSlug: "complete",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createCompletePropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "book",
					entityId: input.entityId,
					eventSchemaName: "Review",
					eventSchemaSlug: "review",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createReviewPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinShowReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "show",
					entityId: input.entityId,
					eventSchemaName: "Review",
					eventSchemaSlug: "review",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createShowReviewPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinAnimeReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "anime",
					entityId: input.entityId,
					eventSchemaName: "Review",
					eventSchemaSlug: "review",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createAnimeReviewPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinMangaReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entitySchemaSlug: "manga",
					entityId: input.entityId,
					eventSchemaName: "Review",
					eventSchemaSlug: "review",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createMangaReviewPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinPodcastReviewEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entityId: input.entityId,
					entitySchemaSlug: "podcast",
					eventSchemaName: "Review",
					eventSchemaSlug: "review",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createPodcastReviewPropertiesSchema(),
				}),
			),
		...overrides,
	});

export const createBuiltinWorkoutSetEventDeps = (
	overrides: Partial<EventServiceDeps> = {},
): EventServiceDeps =>
	createEventDeps({
		getEventCreateScopeForUser: (input) =>
			Promise.resolve(
				createEventCreateScope({
					isBuiltin: true,
					entityId: input.entityId,
					entitySchemaSlug: "exercise",
					eventSchemaName: "Workout Set",
					eventSchemaSlug: "workout-set",
					eventSchemaId: input.eventSchemaId,
					propertiesSchema: createWorkoutSetPropertiesSchema(),
				}),
			),
		...overrides,
	});
