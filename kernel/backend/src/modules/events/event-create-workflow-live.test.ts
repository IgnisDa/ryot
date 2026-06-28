import { expect, it } from "@effect/vitest";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-utils/effect";
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
const createdAt = "2026-01-02T00:00:00.000Z";
const entityId = EntityId.make("entity-1");
const sessionEntityId = EntityId.make("session-1");
const eventSchemaSlug = EventSchemaSlug.make("review");
const entitySchemaSlug = EntitySchemaSlug.make("record");

const payload = {
	userId,
	origin: "api",
	executionId: "event-create-execution",
	payload: [{ entityId, properties: {}, eventSchemaSlug, occurredAt: now }],
} satisfies EventCreateWorkflowPayload;

const entityScope = {
	entityId,
	isBuiltin: false,
	entityName: "Dune",
	entityUserId: userId,
	propertiesSchema: { fields: {} },
	entitySchemaSlug: EntitySchemaSlug.make("record"),
};

const eventSchemaScope = {
	name: "Review",
	slug: "review",
	eventSchemaSlug,
	entitySchemaSlug,
	id: eventSchemaSlug,
	propertiesSchema: { fields: {} },
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ ...overrides });

const mockEventSchemasRepository = Layer.mock(EventSchemasRepository);

const makeEventSchemasRepository = (
	overrides: MockOverrides<typeof mockEventSchemasRepository> = {},
) => mockEventSchemasRepository({ ...overrides });

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({ ...overrides });

const mockAutomationsService = Layer.mock(AutomationsService);

const makeAutomationsService = (overrides: MockOverrides<typeof mockAutomationsService> = {}) =>
	mockAutomationsService({ resolveActivePolicies: () => Effect.succeed([]), ...overrides });

const makeCapturingWorkflowEngine = (
	instance: WorkflowInstance["Service"],
	activityNames: string[],
) => {
	let engine: WorkflowEngine["Service"];

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
		databaseLayer,
		makeAutomationsService(),
		LifecycleDispatchNoop,
		Layer.mock(EventCreateWorkflowOperations, {
			dispatchLifecycleOccurrence: () => Effect.void,
			executeSandboxScript: () => Effect.die("unused"),
		}),
		makeEntitiesRepository({ getEntityScopeForUser: () => Effect.succeed(entityScope) }),
		makeEventSchemasRepository({ getScopeForUser: () => Effect.succeed(eventSchemaScope) }),
		makeEventsRepository({
			createEvent: (input) => {
				createdEventInputs.push(input);
				return Effect.succeed({
					createdAt: now,
					updatedAt: now,
					entityId: input.entityId,
					id: EventId.make("event-1"),
					properties: input.properties,
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
			outcomes: [{ index: 0, status: "written", eventId: EventId.make("event-1") }],
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
			databaseLayer,
			makeAutomationsService({
				resolveActivePolicies: () =>
					Effect.succeed([
						{
							userId,
							position: 100,
							kind: "policy",
							metadata: null,
							isActive: true,
							isBuiltin: true,
							operation: "create",
							name: "Session policy",
							id: AutomationRuleId.make("session-policy"),
							target: { id: eventSchemaSlug, kind: "event_schema" },
							sandboxScriptId: SandboxScriptId.make("session-policy-script"),
						},
					]),
			}),
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
				executeSandboxScript: () =>
					Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { action: "replace", body: { sessionEntityId } },
					}),
			}),
			makeEntitiesRepository({
				getEntityScopeForUser: ({ entityId: requestedEntityId }) =>
					Effect.succeed({ ...entityScope, entityId: requestedEntityId }),
			}),
			makeEventSchemasRepository({ getScopeForUser: () => Effect.succeed(eventSchemaScope) }),
			makeEventsRepository({
				createEvent: (input) =>
					Effect.succeed({
						createdAt,
						updatedAt: now,
						entityId: input.entityId,
						id: EventId.make("event-1"),
						properties: input.properties,
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
					createdAt,
					properties: {},
					occurredAt: now,
					sessionEntityId,
					eventSchemaSlug: "review",
					id: EventId.make("event-1"),
					subject: { id: entityId, name: "Dune", entitySchemaSlug: "record" },
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
		databaseLayer,
		makeAutomationsService(),
		Layer.mock(LifecycleDispatch, {
			dispatch: () => {
				dispatchCalls += 1;
				return Effect.void;
			},
		}),
		Layer.mock(EventCreateWorkflowOperations, {
			executeSandboxScript: () => Effect.die("unused"),
			dispatchLifecycleOccurrence: () => {
				dispatchCalls += 1;
				return Effect.void;
			},
		}),
		makeEntitiesRepository({ getEntityScopeForUser: () => Effect.succeed(entityScope) }),
		makeEventSchemasRepository({ getScopeForUser: () => Effect.succeed(eventSchemaScope) }),
		makeEventsRepository({
			createEvent: (input) =>
				Effect.succeed({
					createdAt: now,
					updatedAt: now,
					entityId: input.entityId,
					id: EventId.make("event-1"),
					properties: input.properties,
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
