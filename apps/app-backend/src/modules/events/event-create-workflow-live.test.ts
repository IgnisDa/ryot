import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { BadRequest, DbError } from "@ryot/contract/errors";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	AutomationRuleId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer, makeWorkflowEngine } from "#lib/test-support/effect";
import { AutomationsRepository, type EventCreatePolicyRow } from "#modules/automations/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { EventCreateWorkflow, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { runEventCreateWorkflow } from "./event-create-workflow-live";
import { EventCreateWorkflowOperations } from "./operations-workflow";
import { EventsRepository } from "./repository";

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

const beforeTrigger: EventCreatePolicyRow = {
	position: 0,
	eventSchemaId,
	sandboxScriptId,
	id: AutomationRuleId.make("before-trigger-1"),
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
		...overrides,
	});

const mockAutomationsRepository = Layer.mock(AutomationsRepository);

const makeAutomationsRepository = (
	overrides: MockOverrides<typeof mockAutomationsRepository> = {},
) =>
	mockAutomationsRepository({
		_tag: "AutomationsRepository",
		listEventCreatePolicies: () => Effect.succeed([]),
		listLifecycleSubscriptions: () => Effect.succeed([]),
		...overrides,
	});

const makeCapturingWorkflowEngine = (
	instance: WorkflowInstance["Type"],
	activityNames: string[],
	workflowExecutions: Array<ReadonlyArray<unknown>> = [],
) => {
	let engine: WorkflowEngine["Type"];

	engine = makeWorkflowEngine({
		execute: (...args) => {
			workflowExecutions.push(args);
			return Effect.void;
		},
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
		makeAutomationsRepository(),
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

		expect(result).toEqual({ count: 1, skipped: 0 });
		expect(activityNames).toEqual([
			"prepare-item-0",
			"write-event-0",
			"resolve-lifecycle-subscriptions-event-create-execution-occurrence-0",
		]);
		expect(createdEventInputs).toHaveLength(1);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("dispatches after-create rules through the durable subscription workflow", () => {
	const activityNames: string[] = [];
	const workflowExecutions: Array<ReadonlyArray<unknown>> = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames, workflowExecutions);
	const subscriptionId = AutomationRuleId.make("subscription-1");
	const layer = Layer.mergeAll(
		dbRunnerLayer,
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
		makeAutomationsRepository({
			listLifecycleSubscriptions: () => Effect.succeed([{ id: subscriptionId }]),
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
		yield* runEventCreateWorkflow(payload);

		expect(workflowExecutions).toHaveLength(1);
		expect(workflowExecutions[0]?.[1]).toMatchObject({
			discard: true,
			payload: {
				ruleId: subscriptionId,
				executionUserId: userId,
				correlationId: payload.executionId,
				executionId: "lifecycle-subscription-event-create-execution-occurrence-0-subscription-1",
				automation: {
					automationDepth: 1,
					operation: "create",
					origin: { kind: "api" },
					occurrenceId: "event-create-execution-occurrence-0",
					source: {
						kind: "event",
						after: { id: "event-1", entitySchemaSlug: "book", eventSchemaSlug: "review" },
					},
				},
			},
		});
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("advances automation depth on the dispatched subscription for nested origins", () => {
	const activityNames: string[] = [];
	const workflowExecutions: Array<ReadonlyArray<unknown>> = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames, workflowExecutions);
	const subscriptionId = AutomationRuleId.make("subscription-1");
	const nestedPayload = {
		...payload,
		origin: "sandbox",
		automationDepth: 2,
		correlationId: "correlation-1",
	} satisfies EventCreateWorkflowPayload;
	const layer = Layer.mergeAll(
		dbRunnerLayer,
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
		makeAutomationsRepository({
			listLifecycleSubscriptions: () => Effect.succeed([{ id: subscriptionId }]),
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
		yield* runEventCreateWorkflow(nestedPayload);

		expect(workflowExecutions).toHaveLength(1);
		expect(workflowExecutions[0]?.[1]).toMatchObject({
			payload: {
				correlationId: "correlation-1",
				automation: {
					automationDepth: 3,
					origin: { kind: "automation", executionId: payload.executionId },
				},
			},
		});
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("fails after the event write when subscription dispatch fails", () => {
	let createEventCalls = 0;
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, []);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
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
		makeAutomationsRepository({
			listLifecycleSubscriptions: () =>
				Effect.fail(new DbError({ message: "dispatch lookup failed" })),
		}),
		makeEventsRepository({
			createEvent: (input) => {
				createEventCalls += 1;
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
		const exit = yield* Effect.exit(runEventCreateWorkflow(payload));

		expect(exit).toEqual(Exit.fail(new DbError({ message: "Event subscription dispatch failed" })));
		expect(createEventCalls).toBe(1);
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
		makeAutomationsRepository({
			listEventCreatePolicies: () => Effect.succeed([beforeTrigger]),
		}),
		makeEventsRepository({
			createEvent: () => {
				createEventCalls += 1;
				return Effect.die("createEvent must not be called when the item is skipped");
			},
		}),
	);

	return Effect.gen(function* () {
		const result = yield* runEventCreateWorkflow(payload);

		expect(result).toEqual({ count: 0, skipped: 1 });
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
		makeAutomationsRepository({
			listEventCreatePolicies: () => Effect.succeed([beforeTrigger]),
		}),
		makeEventsRepository({
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

		expect(result).toEqual({ count: 1, skipped: 0 });
		expect(capturedOccurredAt?.toISOString()).toBe(replacedOccurredAt);
		expect(capturedProperties).toEqual({ rating: 10 });
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("fails the workflow when a before-create trigger reports an error", () => {
	const activityNames: string[] = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () =>
				Effect.succeed({ ...completedSandboxResult(null), error: "test_error" }),
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		makeAutomationsRepository({
			listEventCreatePolicies: () => Effect.succeed([beforeTrigger]),
		}),
		makeEventsRepository({
			createEvent: () => Effect.die("createEvent must not be called when a trigger fails"),
		}),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(runEventCreateWorkflow(payload));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Before trigger failed: test_error" })),
		);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});

it.effect("returns the committed count when a later item fails", () => {
	let triggerCalls = 0;
	const activityNames: string[] = [];
	const batchPayload = { ...payload, payload: [...payload.payload, ...payload.payload] };
	const instance = WorkflowInstance.initial(EventCreateWorkflow, payload.executionId);
	const engine = makeCapturingWorkflowEngine(instance, activityNames);
	const layer = Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(EventCreateWorkflowOperations, {
			ensureLibraryMembership: () => Effect.void,
			processSandboxExecution: () => {
				triggerCalls += 1;
				return Effect.succeed(
					triggerCalls === 1
						? completedSandboxResult({ action: "allow" })
						: { ...completedSandboxResult(null), error: "second_item_failed" },
				);
			},
		}),
		makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(entityScope),
		}),
		makeEventSchemasRepository({
			getScopeForUser: () => Effect.succeed(eventSchemaScope),
		}),
		makeAutomationsRepository({
			listEventCreatePolicies: () => Effect.succeed([beforeTrigger]),
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
		const result = yield* runEventCreateWorkflow(batchPayload);

		expect(result).toEqual({
			count: 1,
			skipped: 0,
			failure: {
				index: 1,
				reason: new BadRequest({ message: "Before trigger failed: second_item_failed" }),
			},
		});
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});
