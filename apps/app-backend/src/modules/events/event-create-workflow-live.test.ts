import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { AutomationsService } from "#modules/automations/service";
import {
	LifecycleDispatch,
	LifecycleDispatchNoop,
	type LifecycleDispatchInput,
} from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { EventCreateWorkflow, type EventCreateWorkflowPayload } from "./event-create-workflow";
import {
	EventCreateWorkflowOperations,
	runEventCreateWorkflow,
} from "./event-create-workflow-live";
import { EventsRepository, type BeforeCreateTriggerRow } from "./repository";

const now = "2026-01-01T00:00:00.000Z";
const userId = UserId.make("user-id");
const entityId = EntityId.make("entity-1");
const eventSchemaId = EventSchemaId.make("event-schema-1");
const entitySchemaId = EntitySchemaId.make("entity-schema-1");
const sandboxScriptId = SandboxScriptId.make("sandbox-script-1");

const payload = {
	userId,
	origin: "api",
	executionId: "event-create-execution",
	payload: [{ entityId, eventSchemaId, occurredAt: now, properties: {} }],
} satisfies EventCreateWorkflowPayload;

const entityScope = {
	entityId,
	entitySchemaId,
	isBuiltin: false,
	entityName: "Dune",
	entityUserId: userId,
	entitySchemaSlug: "book",
	propertiesSchema: { fields: {} },
};

const eventSchemaScope = {
	eventSchemaId,
	entitySchemaId,
	name: "Review",
	slug: "review",
	id: eventSchemaId,
	propertiesSchema: { fields: {} },
};

const beforeTrigger: BeforeCreateTriggerRow = {
	id: "before-trigger-1",
	position: 0,
	eventSchemaId,
	sandboxScriptId,
};

const completedSandboxResult = (value: unknown): SandboxCompletedResult => ({
	value,
	logs: [],
	error: null,
	status: "completed",
});

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

const mockAutomationsService = Layer.mock(AutomationsService);

const makeAutomationsService = (overrides: MockOverrides<typeof mockAutomationsService> = {}) =>
	mockAutomationsService({
		_tag: "AutomationsService",
		resolveActivePolicies: () => Effect.succeed([]),
		...overrides,
	});

const makeCapturingWorkflowEngine = (
	instance: WorkflowInstance["Type"],
	activityNames: string[],
) => {
	let engine: WorkflowEngine["Type"];

	engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				activityNames.push(activity.name);
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);

				return new Workflow.Complete({ exit });
			}),
	});

	return engine;
};

it.effect("creates events inside workflow activities", () => {
	const activityNames: string[] = [];
	const createdEventInputs: unknown[] = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		makeAutomationsService(),
		LifecycleDispatchNoop,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () => Effect.die("unused"),
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		makeEventsRepository({
			createEvent: (input) => {
				createdEventInputs.push(input);
				return Effect.succeed({
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
				});
			},
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload);

		expect(result).toEqual({
			count: 1,
			failure: null,
			outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
		});
		expect(activityNames).toEqual(["prepare-item-0", "write-event-0", "resolve-after-triggers"]);
		expect(createdEventInputs).toHaveLength(1);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect(
	"dispatches a lifecycle occurrence per created event when a lifecycle origin is set",
	() => {
		const activityNames: string[] = [];
		const dispatched: LifecycleDispatchInput[] = [];
		const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
		const engine = makeCapturingWorkflowEngine(instance, activityNames);
		const layer = Layer.mergeAll(
			dbRunnerLayer,
			makeAutomationsService(),
			Layer.mock(LifecycleDispatch, {
				dispatch: (input) => {
					dispatched.push(input);
					return Effect.void;
				},
			}),
			Layer.mock(EventCreateWorkflowOperations, {
				ensureLibraryMembership: () => Effect.void,
				processSandboxExecution: () => Effect.die("unused"),
			}),
			makeEntitiesRepository({
				getEntityScopeForUser: () => Effect.succeed(entityScope),
			}),
			makeEventSchemasRepository({
				getScopeForUser: () => Effect.succeed(eventSchemaScope),
			}),
			makeEventsRepository({
				createEvent: (input) =>
					Effect.succeed({
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
					}),
			}),
		);

		return Effect.gen(function* () {
			yield* runEventCreateWorkflow({ ...payload, lifecycleOrigin: { kind: "api" } });

			expect(dispatched).toHaveLength(1);
			const [occurrence] = dispatched;
			expect(occurrence?.origin).toEqual({ kind: "api" });
			expect(occurrence?.recordId).toBe("event-1");
			expect(occurrence?.occurrenceId).toBe(`${payload.executionId}-lifecycle-0`);
			expect(occurrence?.source).toEqual({
				kind: "event",
				after: {
					eventSchemaId,
					properties: {},
					occurredAt: now,
					eventSchemaSlug: "review",
					id: EventId.make("event-1"),
					subject: { id: entityId, name: "Dune", entitySchemaSlug: "book" },
				},
			});
		}).pipe(
			Effect.provide(layer),
			Effect.provideService(WorkflowEngine, engine),
			Effect.provideService(WorkflowInstance, instance),
		);
	},
);

it.effect("does not dispatch a lifecycle occurrence when no lifecycle origin is set", () => {
	const activityNames: string[] = [];
	let dispatchCalls = 0;
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		makeAutomationsService(),
		Layer.mock(LifecycleDispatch, {
			dispatch: () => {
				dispatchCalls += 1;
				return Effect.void;
			},
		}),
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () => Effect.die("unused"),
		}),
		makeEntitiesRepository({ getEntityScopeForUser: () => Effect.succeed(entityScope) }),
		makeEventSchemasRepository({ getScopeForUser: () => Effect.succeed(eventSchemaScope) }),
		makeEventsRepository({
			createEvent: (input) =>
				Effect.succeed({
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
				}),
		}),
	);

	return Effect.gen(function* () {
		yield* runEventCreateWorkflow(payload);
		expect(dispatchCalls).toBe(0);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("skips event creation when a before-create trigger returns skip", () => {
	const activityNames: string[] = [];
	let createEventCalls = 0;
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		makeAutomationsService(),
		LifecycleDispatchNoop,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () =>
				Effect.succeed(completedSandboxResult({ action: "skip", reason: "not allowed" })),
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		makeEventsRepository({
			getActiveBeforeCreateTriggers: () => Effect.succeed([beforeTrigger]),
			createEvent: () => {
				createEventCalls += 1;
				return Effect.die("createEvent must not be called when the item is skipped");
			},
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload);

		expect(result).toEqual({
			count: 0,
			failure: null,
			outcomes: [{ index: 0, reason: "not allowed", status: "skipped_by_policy" }],
		});
		expect(createEventCalls).toBe(0);
		expect(activityNames).toEqual(["prepare-item-0"]);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("applies a before-create trigger replace to the created event", () => {
	const replacedOccurredAt = "2027-02-02T00:00:00.000Z";
	const activityNames: string[] = [];
	let capturedOccurredAt: Date | undefined;
	let capturedProperties: Record<string, unknown> | undefined;
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const eventSchemaWithRating = {
		...eventSchemaScope,
		propertiesSchema: {
			fields: { rating: { label: "Rating", description: "Rating", type: "number" as const } },
		},
	};
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		makeAutomationsService(),
		LifecycleDispatchNoop,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () =>
				Effect.succeed(
					completedSandboxResult({
						action: "replace",
						body: { occurredAt: replacedOccurredAt, properties: { rating: 10 } },
					}),
				),
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaWithRating),
		}),
		makeEventsRepository({
			getActiveBeforeCreateTriggers: () => Effect.succeed([beforeTrigger]),
			createEvent: (input) => {
				capturedOccurredAt = input.occurredAt;
				capturedProperties = input.properties;
				return Effect.succeed({
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
				});
			},
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload);

		expect(result).toEqual({
			count: 1,
			failure: null,
			outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
		});
		expect(capturedOccurredAt?.toISOString()).toBe(replacedOccurredAt);
		expect(capturedProperties).toEqual({ rating: 10 });
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("returns a typed item failure when a before-create trigger reports an error", () => {
	const activityNames: string[] = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		makeAutomationsService(),
		LifecycleDispatchNoop,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () =>
				Effect.succeed({
					...completedSandboxResult(null),
					error: { phase: "execute" as const, message: "test_error" },
				}),
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		makeEventsRepository({
			getActiveBeforeCreateTriggers: () => Effect.succeed([beforeTrigger]),
			createEvent: () => Effect.die("createEvent must not be called when a trigger fails"),
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload);

		expect(result).toEqual({
			count: 0,
			outcomes: [],
			failure: {
				index: 0,
				reason: { kind: "bad_request", message: "Before trigger failed: test_error" },
			},
		});
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});
