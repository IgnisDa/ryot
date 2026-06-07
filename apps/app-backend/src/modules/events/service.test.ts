import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { BadRequest, NotFound } from "#lib/errors";
import { SandboxService } from "#lib/sandbox/service";
import { dbRunnerLayer, makeMock, makeWorkflowEngine } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { createEventsForUser } from "./create-core";
import { GlobalEntityReferenceHook } from "./global-entity-reference-hook";
import { EventsRepository } from "./repository";
import type { CreateEventItem } from "./schemas";
import { EventsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const entityScope = {
	isBuiltin: false,
	entityId: "entity-1",
	entityUserId: user.id,
	entitySchemaSlug: "book",
	entitySchemaId: "entity-schema-1",
};

const eventSchemaScope = {
	slug: "finished",
	name: "Finished",
	id: "event-schema-1",
	entitySchemaId: "entity-schema-1",
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

const defaultSandboxRunResult = {
	logs: [],
	error: null,
	success: true,
	executionId: "exec-1",
	value: { action: "allow" },
	timing: { totalMs: 1, executionMs: 1 },
};

const makeSandboxService = (overrides: Record<string, unknown> = {}) =>
	Object.assign(
		makeMock<SandboxService>({
			_tag: "SandboxService" as const,
			run: () => Effect.succeed(defaultSandboxRunResult),
		}),
		overrides,
	);

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			createEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			getEntityScopeById: () => Effect.die("unused"),
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

const makeSandboxRepository = (overrides: Partial<SandboxRepository> = {}) =>
	makeMock<SandboxRepository>(
		{
			_tag: "SandboxRepository" as const,
			createScript: () => Effect.die("unused"),
			getScriptForUser: () => Effect.succeed(null),
			findScriptBySlugForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeServiceLayer = (input: {
	sandboxService?: SandboxService;
	eventsRepository?: EventsRepository;
	sandboxRepository?: SandboxRepository;
	workflowEngine?: WorkflowEngine["Type"];
	entitiesRepository?: EntitiesRepository;
	eventSchemasRepository?: EventSchemasRepository;
}) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(WorkflowEngine, input.workflowEngine ?? makeWorkflowEngine()),
		Layer.succeed(SandboxService, input.sandboxService ?? makeSandboxService()),
		Layer.succeed(SandboxRepository, input.sandboxRepository ?? makeSandboxRepository()),
		Layer.succeed(EntitiesRepository, input.entitiesRepository ?? makeEntitiesRepository()),
		GlobalEntityReferenceHook.Default,
		Layer.succeed(
			EventSchemasRepository,
			input.eventSchemasRepository ?? makeEventSchemasRepository(),
		),
		Layer.succeed(EventsRepository, input.eventsRepository ?? makeEventsRepository()),
	);

const makeEventsServiceLayer = (input: Parameters<typeof makeServiceLayer>[0]) =>
	EventsService.Default.pipe(Layer.provide(makeServiceLayer(input)));

const runCreateCore = (payload: ReadonlyArray<CreateEventItem>) =>
	Effect.gen(function* () {
		const sandbox = yield* SandboxService;
		return yield* createEventsForUser({ payload, origin: "api", userId: user.id }, sandbox.run);
	});

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
		const exit = yield* Effect.exit(service.list(user, { entityId: "entity-1" }));

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
		const exit = yield* Effect.exit(service.list(user, { sessionEntityId: "session-entity-1" }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Session entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("lists events for an accessible entity", () => {
	const events = [
		{
			id: "event-1",
			createdAt: now,
			updatedAt: now,
			occurredAt: now,
			entityId: "entity-1",
			properties: { rating: 5 },
			eventSchemaName: "Finished",
			eventSchemaSlug: "finished",
			eventSchemaId: "event-schema-1",
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
		const result = yield* service.list(user, { entityId: "entity-1" });

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
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
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
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
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
				Effect.succeed({ ...eventSchemaScope, entitySchemaId: "other-entity-schema" }),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* EventsService;
		const exit = yield* Effect.exit(
			service.create(user, [
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
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
					entityId: "entity-1",
					properties: { rating: 5 },
					eventSchemaId: "event-schema-1",
					sessionEntityId: "session-entity-1",
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
				{ properties: {}, entityId: "entity-1", eventSchemaId: "event-schema-1" },
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
						id: "event-1",
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
				entityId: "entity-1",
				properties: { rating: 5 },
				eventSchemaId: "event-schema-1",
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
						entityId: "entity-1",
						properties: { rating: 5 },
						eventSchemaId: "event-schema-1",
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
			[{ entityId: "entity-1", properties: { rating: 5 }, eventSchemaId: "event-schema-1" }],
			"run-1",
		);

		expect(result).toEqual({ count: 1 });
		expect(capturedOptions).toMatchObject({
			payload: { userId: user.id, origin: "import", importRunId: "run-1" },
		});
		expect(capturedOptions?.discard).toBeUndefined();
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger skip prevents event creation", () => {
	const sandboxRepo = makeSandboxRepository({
		getScriptForUser: () =>
			Effect.succeed({
				id: "script-1",
				userId: user.id,
				metadata: { allowedHostFunctions: [] },
				code: `driver("trigger", async () => ({ action: "skip", reason: "test" }))`,
			}),
	});

	const layer = makeServiceLayer({
		sandboxRepository: sandboxRepo,
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		sandboxService: makeSandboxService({
			run: () =>
				Effect.succeed({
					...defaultSandboxRunResult,
					value: { action: "skip", reason: "test_skip" },
				}),
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						sandboxScriptId: "script-1",
						eventSchemaId: "event-schema-1",
					},
				]),
		}),
	});

	return Effect.gen(function* () {
		const result = yield* runCreateCore([
			{ properties: { rating: 5 }, entityId: "entity-1", eventSchemaId: "event-schema-1" },
		]);

		expect(result).toEqual({ count: 0 });
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger replace modifies event properties", () => {
	const createCalls: unknown[] = [];
	const sandboxRepo = makeSandboxRepository({
		getScriptForUser: () =>
			Effect.succeed({
				id: "script-1",
				userId: user.id,
				metadata: { allowedHostFunctions: [] },
				code: `driver("trigger", async () => ({ action: "replace", body: { properties: { rating: 10 } } }))`,
			}),
	});

	const eventSchemaWithNoRequired = {
		...eventSchemaScope,
		propertiesSchema: {
			fields: { rating: { label: "Rating", description: "Rating", type: "number" as const } },
		},
	};

	const layer = makeServiceLayer({
		sandboxRepository: sandboxRepo,
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaWithNoRequired),
		}),
		sandboxService: makeSandboxService({
			run: () =>
				Effect.succeed({
					...defaultSandboxRunResult,
					value: { action: "replace", body: { properties: { rating: 10 } } },
				}),
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						sandboxScriptId: "script-1",
						eventSchemaId: "event-schema-1",
					},
				]),
			createEvent: (input) =>
				Effect.sync(() => {
					createCalls.push(input);
					return {
						id: "event-1",
						entityId: input.entityId,
						properties: input.properties,
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
			{ properties: { rating: 1 }, entityId: "entity-1", eventSchemaId: "event-schema-1" },
		]);

		expect(result).toEqual({ count: 1 });
		expect(createCalls).toMatchObject([{ properties: { rating: 10 } }]);
	}).pipe(Effect.provide(layer));
});

it.effect("before-create trigger failure prevents event creation", () => {
	const sandboxRepo = makeSandboxRepository({
		getScriptForUser: () =>
			Effect.succeed({
				id: "script-1",
				userId: user.id,
				metadata: { allowedHostFunctions: [] },
				code: `driver("trigger", async () => { throw new Error("test_error"); })`,
			}),
	});

	const layer = makeServiceLayer({
		sandboxRepository: sandboxRepo,
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		eventSchemasRepository: makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		sandboxService: makeSandboxService({
			run: () =>
				Effect.succeed({
					...defaultSandboxRunResult,
					value: null,
					success: false,
					error: "test_error",
				}),
		}),
		eventsRepository: makeEventsRepository({
			getActiveBeforeCreateTriggers: () =>
				Effect.succeed([
					{
						position: 100,
						id: "trigger-1",
						sandboxScriptId: "script-1",
						eventSchemaId: "event-schema-1",
					},
				]),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runCreateCore([
				{ properties: { rating: 5 }, entityId: "entity-1", eventSchemaId: "event-schema-1" },
			]),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Before trigger failed: test_error" })),
		);
	}).pipe(Effect.provide(layer));
});
