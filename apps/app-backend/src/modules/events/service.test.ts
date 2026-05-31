import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	ImportRunId,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import { dbRunnerLayer, makeMock, makeWorkflowEngine } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { RunSandboxWorkflow } from "#modules/sandbox/workflow-definitions";

import { createEventsForUser } from "./create-core";
import { EventsRepository } from "./repository";
import type { CreateEventItem } from "./schemas";
import { EventsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	id: UserId.make("user-id"),
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const entityScope = {
	isBuiltin: false,
	entityId: EntityId.make("entity-1"),
	entityUserId: user.id,
	entitySchemaSlug: "book",
	entitySchemaId: EntitySchemaId.make("entity-schema-1"),
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

const defaultSandboxWorkflowResult = {
	logs: [],
	error: null,
	value: { action: "allow" },
	status: "completed" as const,
	timing: { totalMs: 1, executionMs: 1 },
};

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			saveEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			insertRelationship: () => Effect.die("unused"),
			upsertRelationship: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			upsertEntityRelationship: () => Effect.die("unused"),
			deleteUserEventsForEntity: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
			deleteUserRelationshipsForEntity: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEventSchemasRepository = (overrides: Partial<EventSchemasRepository> = {}) =>
	makeMock<EventSchemasRepository>(
		{
			_tag: "EventSchemasRepository" as const,
			getScopeForUser: () => Effect.die("unused"),
			createEventSchema: () => Effect.die("unused"),
			findBySlugForUser: () => Effect.die("unused"),
			getEntitySchemaScopeById: () => Effect.die("unused"),
			listByEntitySchemaForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeEventsRepository = (overrides: Partial<EventsRepository> = {}) =>
	makeMock<EventsRepository>(
		{
			_tag: "EventsRepository" as const,
			listForUser: () => Effect.die("unused"),
			createEvent: () => Effect.die("unused"),
			getActiveAfterCreateTriggers: () => Effect.succeed([]),
			getActiveBeforeCreateTriggers: () => Effect.succeed([]),
		},
		overrides,
	);

const makeServiceLayer = (input: {
	eventsRepository?: EventsRepository;
	workflowEngine?: WorkflowEngine["Type"];
	entitiesRepository?: EntitiesRepository;
	eventSchemasRepository?: EventSchemasRepository;
}) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(WorkflowEngine, input.workflowEngine ?? makeWorkflowEngine()),
		Layer.succeed(EntitiesRepository, input.entitiesRepository ?? makeEntitiesRepository()),
		Layer.succeed(
			EventSchemasRepository,
			input.eventSchemasRepository ?? makeEventSchemasRepository(),
		),
		Layer.succeed(EventsRepository, input.eventsRepository ?? makeEventsRepository()),
	);

const makeEventsServiceLayer = (input: Parameters<typeof makeServiceLayer>[0]) =>
	EventsService.Default.pipe(Layer.provide(makeServiceLayer(input)));

const runCreateCore = (payload: ReadonlyArray<CreateEventItem>) =>
	createEventsForUser({ payload, origin: "api", userId: user.id, executionId: "test-execution" });

it.effect("requires entityId or sessionEntityId when listing events", () => {
	const layer = makeEventsServiceLayer({});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(service.list(user, {}));

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
		const exit = yield* Effect.exit(service.list(user, { entityId: EntityId.make("entity-1") }));

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
			service.list(user, { sessionEntityId: EntityId.make("session-entity-1") }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("lists events for an accessible entity", () => {
	const events = [
		{
			id: EventId.make("event-1"),
			createdAt: now,
			updatedAt: now,
			occurredAt: now,
			entityId: EntityId.make("entity-1"),
			properties: { rating: 5 },
			eventSchemaName: "Finished",
			eventSchemaSlug: "finished",
			eventSchemaId: EventSchemaId.make("event-schema-1"),
		},
	];

	const layer = makeEventsServiceLayer({
		eventsRepository: makeEventsRepository({ listForUser: () => Effect.succeed(events) }),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.list(user, { entityId: EntityId.make("entity-1") });

		expect(result).toEqual(events);
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
			service.create(user, [
				{
					properties: {},
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			]),
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
			service.create(user, [
				{
					properties: {},
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			]),
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
			service.create(user, [
				{
					properties: {},
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			]),
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
			service.create(user, [
				{
					entityId: EntityId.make("entity-1"),
					properties: { rating: 5 },
					eventSchemaId: EventSchemaId.make("event-schema-1"),
					sessionEntityId: EntityId.make("session-entity-1"),
				},
			]),
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
			service.create(user, [
				{
					properties: {},
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			]),
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
						id: EventId.make("event-1"),
						createdAt: now,
						updatedAt: now,
						entityId: input.entityId,
						properties: input.properties,
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
		const result = yield* service.create(user, [
			{
				entityId: EntityId.make("entity-1"),
				properties: { rating: 5 },
				eventSchemaId: EventSchemaId.make("event-schema-1"),
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);

		expect(result).toEqual({ count: 1 });
		expect(createCalled).toBe(false);
		expect(capturedOptions).toMatchObject({
			discard: true,
			payload: {
				origin: "api",
				userId: user.id,
				payload: [
					{
						entityId: EntityId.make("entity-1"),
						properties: { rating: 5 },
						eventSchemaId: EventSchemaId.make("event-schema-1"),
						occurredAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});
		expect(typeof capturedOptions?.payload.executionId).toBe("string");
	}).pipe(Effect.provide(layer));
});

it.effect("createForImport waits for the queued workflow result", () => {
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;

	const layer = makeEventsServiceLayer({
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, options) => {
				capturedOptions = options;
				return Effect.succeed({ count: 1 });
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const result = yield* service.createForImport(
			user.id,
			[
				{
					entityId: EntityId.make("entity-1"),
					properties: { rating: 5 },
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			],
			ImportRunId.make("run-1"),
			"run-1-event-0-0",
		);

		expect(result).toEqual({ count: 1 });
		expect(capturedOptions).toMatchObject({
			payload: {
				userId: user.id,
				origin: "import",
				importRunId: "run-1",
				executionId: "run-1-event-0-0",
			},
		});
		expect(capturedOptions?.discard).toBeUndefined();
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger skip prevents event creation", () => {
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;
	let capturedWorkflow: Parameters<WorkflowEngine["Type"]["execute"]>[0] | undefined;

	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		workflowEngine: makeWorkflowEngine({
			execute: (workflow, options) => {
				capturedWorkflow = workflow;
				capturedOptions = options;
				return Effect.succeed({
					...defaultSandboxWorkflowResult,
					value: { action: "skip", reason: "test_skip" },
				});
			},
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						sandboxScriptId: SandboxScriptId.make("script-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				]),
		}),
	});

	return Effect.gen(function* () {
		const result = yield* runCreateCore([
			{
				occurredAt: now,
				properties: { rating: 5 },
				entityId: EntityId.make("entity-1"),
				eventSchemaId: EventSchemaId.make("event-schema-1"),
			},
		]);

		expect(result).toEqual({ count: 0, referencedGlobalEntityIds: [] });
		expect(capturedWorkflow).toBe(RunSandboxWorkflow);
		expect(capturedOptions).toEqual({
			executionId: "test-execution-before-0-trigger-1",
			payload: {
				userId: user.id,
				driverName: "trigger",
				scriptId: SandboxScriptId.make("script-1"),
				executionId: "test-execution-before-0-trigger-1",
				context: {
					trigger: {
						origin: "api",
						userId: user.id,
						occurredAt: now,
						phase: "before_create",
						entitySchemaSlug: "book",
						properties: { rating: 5 },
						sessionEntityId: undefined,
						eventSchemaSlug: "finished",
						entityId: EntityId.make("entity-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
						entitySchemaId: EntitySchemaId.make("entity-schema-1"),
					},
				},
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger replace modifies event properties", () => {
	const createCalls: unknown[] = [];

	const eventSchemaWithNoRequired = {
		...eventSchemaScope,
		propertiesSchema: {
			fields: { rating: { label: "Rating", description: "Rating", type: "number" as const } },
		},
	};

	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaWithNoRequired),
		}),
		workflowEngine: makeWorkflowEngine({
			execute: () =>
				Effect.succeed({
					...defaultSandboxWorkflowResult,
					value: { action: "replace", body: { properties: { rating: 10 } } },
				}),
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						eventSchemaId: EventSchemaId.make("event-schema-1"),
						sandboxScriptId: SandboxScriptId.make("script-1"),
					},
				]),
			createEvent: (input) =>
				Effect.sync(() => {
					createCalls.push(input);
					return {
						entityId: input.entityId,
						properties: input.properties,
						id: EventId.make("event-1"),
						eventSchemaId: input.eventSchemaId,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId,
						occurredAt: input.occurredAt.toISOString(),
					};
				}),
		}),
	});

	return Effect.gen(function* () {
		const result = yield* runCreateCore([
			{
				properties: { rating: 1 },
				entityId: EntityId.make("entity-1"),
				eventSchemaId: EventSchemaId.make("event-schema-1"),
			},
		]);

		expect(result).toEqual({ count: 1, referencedGlobalEntityIds: [] });
		expect(createCalls).toMatchObject([{ properties: { rating: 10 } }]);
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger failure prevents event creation", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		workflowEngine: makeWorkflowEngine({
			execute: () =>
				Effect.succeed({ ...defaultSandboxWorkflowResult, value: null, error: "test_error" }),
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						sandboxScriptId: SandboxScriptId.make("script-1"),
						eventSchemaId: EventSchemaId.make("event-schema-1"),
					},
				]),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runCreateCore([
				{
					properties: { rating: 5 },
					entityId: EntityId.make("entity-1"),
					eventSchemaId: EventSchemaId.make("event-schema-1"),
				},
			]),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Before trigger failed: test_error" })),
		);
	}).pipe(Effect.provide(layer));
});
