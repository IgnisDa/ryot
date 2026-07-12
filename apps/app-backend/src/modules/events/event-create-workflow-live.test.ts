import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
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
import { EventsRepository } from "./repository";

const now = "2026-01-01T00:00:00.000Z";
const userId = UserId.make("user-id");
const entityId = EntityId.make("entity-1");
const eventSchemaSlug = EventSchemaSlug.make("review");
const entitySchemaSlug = EntitySchemaSlug.make("book");

const payload = {
	userId,
	origin: "api",
	executionId: "event-create-execution",
	payload: [{ entityId, eventSchemaSlug, occurredAt: now, properties: {} }],
} satisfies EventCreateWorkflowPayload;

const entityScope = {
	entityId,
	isBuiltin: false,
	entityName: "Dune",
	entityUserId: userId,
	entitySchemaSlug: EntitySchemaSlug.make("book"),
	propertiesSchema: { fields: {} },
};

const eventSchemaScope = {
	eventSchemaSlug,
	entitySchemaSlug,
	name: "Review",
	slug: "review",
	id: eventSchemaSlug,
	propertiesSchema: { fields: {} },
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
			dispatchLifecycleOccurrence: () => Effect.void,
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
					eventSchemaName: input.eventSchemaName,
					eventSchemaSlug: input.eventSchemaSlug,
					sessionEntityId: input.sessionEntityId,
					occurredAt: input.occurredAt.toISOString(),
				});
			},
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload, payload.executionId);

		expect(result).toEqual({
			count: 1,
			failure: null,
			outcomes: [{ index: 0, eventId: EventId.make("event-1"), status: "written" }],
		});
		expect(activityNames).toEqual(["prepare-item-0", "write-event-0"]);
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
				dispatchLifecycleOccurrence: (input) => {
					dispatched.push(input);
					return Effect.void;
				},
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
						eventSchemaName: input.eventSchemaName,
						eventSchemaSlug: input.eventSchemaSlug,
						sessionEntityId: input.sessionEntityId,
						occurredAt: input.occurredAt.toISOString(),
					}),
			}),
		);

		return Effect.gen(function* () {
			yield* runEventCreateWorkflow(
				{ ...payload, lifecycleOrigin: { kind: "api" } },
				payload.executionId,
			);

			expect(dispatched).toHaveLength(1);
			const [occurrence] = dispatched;
			expect(occurrence?.origin).toEqual({ kind: "api" });
			expect(occurrence?.recordId).toBe("event-1");
			expect(occurrence?.occurrenceId).toBe(`${payload.executionId}-lifecycle-0`);
			expect(occurrence?.source).toEqual({
				kind: "event",
				after: {
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
			dispatchLifecycleOccurrence: () => {
				dispatchCalls += 1;
				return Effect.void;
			},
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
					eventSchemaName: input.eventSchemaName,
					eventSchemaSlug: input.eventSchemaSlug,
					sessionEntityId: input.sessionEntityId,
					occurredAt: input.occurredAt.toISOString(),
				}),
		}),
	);

	return Effect.gen(function* () {
		yield* runEventCreateWorkflow(payload, payload.executionId);
		expect(dispatchCalls).toBe(0);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});
