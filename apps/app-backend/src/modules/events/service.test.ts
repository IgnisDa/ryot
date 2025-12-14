import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	ImportRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const entityScope = {
	isBuiltin: false,
	entityId: EntityId.make("entity-1"),
	entityUserId: user.id,
	entitySchemaSlug: "book",
	entitySchemaId: EntitySchemaId.make("entity-schema-1"),
	propertiesSchema: { fields: {} },
};

const eventSchemaScope = {
	slug: "finished",
	name: "Finished",
	id: EventSchemaId.make("event-schema-1"),
	entitySchemaId: EntitySchemaId.make("entity-schema-1"),
	propertiesSchema: {
		fields: {
			rating: {
				label: "Rating",
				description: "Rating",
				type: "number" as const,
				validation: { required: true as const },
			},
		},
	},
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });

const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) => mockEventSchemasRepository({ _tag: "EventSchemasRepository", ...overrides });

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({
		_tag: "EventsRepository",
		getActiveAfterCreateTriggers: () => Effect.succeed([]),
		getActiveBeforeCreateTriggers: () => Effect.succeed([]),
		...overrides,
	});

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (input: {
	queryEngine?: ReturnType<typeof makeQueryEngine>;
	eventsRepository?: ReturnType<typeof makeEventsRepository>;
	workflowEngine?: WorkflowEngine["Type"];
	entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
	eventSchemasRepository?: ReturnType<typeof makeEventSchemasRepository>;
}) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(WorkflowEngine, input.workflowEngine ?? makeWorkflowEngine()),
		input.queryEngine ?? makeQueryEngine(),
		input.entitiesRepository ?? makeEntitiesRepository(),
		input.eventSchemasRepository ?? makeEventSchemasRepository(),
		input.eventsRepository ?? makeEventsRepository(),
	);

const makeEventsServiceLayer = (input: Parameters<typeof makeServiceLayer>[0]) =>
	EventsService.Default.pipe(Layer.provide(makeServiceLayer(input)));

it.effect("requires entityId or sessionEntityId when listing events", () => {
	const layer = makeEventsServiceLayer({});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(service.listForUser(user.id, {}));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Either entityId or sessionEntityId is required" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when listing events for an inaccessible entity", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.listForUser(user.id, { entityId: EntityId.make("entity-1") }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when listing events for an inaccessible session entity", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.listForUser(user.id, { sessionEntityId: EntityId.make("session-entity-1") }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("lists events for an accessible entity", () => {
	const events = [
		{
			createdAt: now,
			updatedAt: now,
			occurredAt: now,
			properties: { rating: 5 },
			eventSchemaName: "Finished",
			eventSchemaSlug: "finished",
			id: EventId.make("event-1"),
			entityId: EntityId.make("entity-1"),
			eventSchemaId: EventSchemaId.make("event-schema-1"),
		},
	];

	const layer = makeEventsServiceLayer({
		queryEngine: makeQueryEngine({
			execute: () =>
				Effect.succeed({
					type: "rows" as const,
					data: {
						pageInfo: { page: 1, limit: 100, total: 1, hasMore: false },
						items: [
							{
								id: { kind: "text" as const, value: "event-1" },
								createdAt: { kind: "date" as const, value: now },
								updatedAt: { kind: "date" as const, value: now },
								occurredAt: { kind: "date" as const, value: now },
								entityId: { kind: "text" as const, value: "entity-1" },
								sessionEntityId: { kind: "null" as const, value: null },
								properties: { kind: "json" as const, value: { rating: 5 } },
								eventSchemaName: { kind: "text" as const, value: "Finished" },
								eventSchemaSlug: { kind: "text" as const, value: "finished" },
								eventSchemaId: { kind: "text" as const, value: "event-schema-1" },
							},
						],
					},
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			listByEntitySchemaForUser: () => Effect.succeed([eventSchemaScope]),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.listForUser(user.id, { entityId: EntityId.make("entity-1") });

		expect(result).toEqual(events);
	}).pipe(Effect.provide(layer));
});

it.effect("routes per-event deletes and reference moves through the repository", () => {
	const calls: string[] = [];
	const layer = makeEventsServiceLayer({
		eventsRepository: makeEventsRepository({
			deleteEvent: (input) =>
				Effect.sync(() => {
					calls.push(`delete:${input.eventId}`);
					return input.eventId;
				}),
			updateEventEntityReferences: (input) =>
				Effect.sync(() => {
					calls.push(`${input.eventId}:${input.mergeFrom}->${input.mergeInto}`);
					return input.eventId;
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const eventId = EventId.make("event-1");

		const updated = yield* service.update({
			eventId,
			mergeFrom: EntityId.make("from"),
			mergeInto: EntityId.make("into"),
			userId: user.id,
		});
		const deleted = yield* service.delete({ eventId, userId: user.id });

		expect(updated).toBe(eventId);
		expect(deleted).toBe(eventId);
		expect(calls).toEqual(["event-1:from->into", "delete:event-1"]);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when creating an event for an inaccessible entity", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create({
				source: "api",
				userId: user.id,
				payload: [
					{
						properties: {},
						entityId: EntityId.make("entity-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				],
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when the event schema is not visible to the user", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create({
				source: "api",
				userId: user.id,
				payload: [
					{
						properties: {},
						entityId: EntityId.make("entity-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				],
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Event schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when the event schema does not belong to the entity schema", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () =>
				Effect.succeed({
					...eventSchemaScope,
					entitySchemaId: EntitySchemaId.make("other-entity-schema"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create({
				source: "api",
				userId: user.id,
				payload: [
					{
						properties: {},
						entityId: EntityId.make("entity-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				],
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Event schema does not belong to the entity schema" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when the session entity is not accessible", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "entity-1" ? entityScope : null),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create({
				source: "api",
				userId: user.id,
				payload: [
					{
						entityId: EntityId.make("entity-1"),
						properties: { rating: 5 },
						eventSchemaId: EventSchemaId.make("event-schema-1"),
						sessionEntityId: EntityId.make("session-entity-1"),
					},
				],
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns bad request when event properties fail schema validation", () => {
	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create({
				source: "api",
				userId: user.id,
				payload: [
					{
						properties: {},
						entityId: EntityId.make("entity-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				],
			}),
		);

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "rating: is missing" })));
	}).pipe(Effect.provide(layer));
});

it.effect("queues API event creation after validation and returns the requested count", () => {
	let createCalled = false;
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;

	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed(options.executionId);
			},
		}),
		eventsRepository: makeEventsRepository({
			createEvent: (input) =>
				Effect.sync(() => {
					createCalled = true;
					return {
						createdAt: now,
						updatedAt: now,
						entityId: input.entityId,
						properties: input.properties,
						id: EventId.make("event-1"),
						eventSchemaId: input.eventSchemaId,
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId,
						occurredAt: input.occurredAt.toISOString(),
					};
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.create({
			userId: user.id,
			source: "api",
			payload: [
				{
					properties: { rating: 5 },
					entityId: EntityId.make("entity-1"),
					occurredAt: "2026-01-01T00:00:00.000Z",
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			],
		});

		expect(result).toEqual({ count: 1 });
		expect(createCalled).toBe(false);
		expect(capturedOptions).toMatchObject({
			discard: true,
			payload: {
				origin: "api",
				userId: user.id,
				payload: [
					{
						properties: { rating: 5 },
						entityId: EntityId.make("entity-1"),
						occurredAt: "2026-01-01T00:00:00.000Z",
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				],
			},
		});
		expect(typeof capturedOptions?.payload.executionId).toBe("string");
	}).pipe(Effect.provide(layer));
});

it.effect("import event creation validates and enqueues without waiting for insertion", () => {
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;

	const layer = makeEventsServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed({ count: 1 });
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.create({
			userId: user.id,
			source: "import",
			executionId: "run-1-event-0-0",
			metadata: { importRunId: ImportRunId.make("run-1") },
			payload: [
				{
					properties: { rating: 5 },
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			],
		});

		expect(result).toEqual({ count: 1 });
		expect(capturedOptions).toMatchObject({
			payload: {
				userId: user.id,
				origin: "import",
				importRunId: "run-1",
				executionId: "run-1-event-0-0",
			},
		});
		expect(capturedOptions?.discard).toBe(true);
	}).pipe(Effect.provide(layer));
});
