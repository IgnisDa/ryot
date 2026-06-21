import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { BadRequest } from "@ryot/contract/errors";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer, makeWorkflowEngine } from "#lib/test-support/effect";
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
		Layer.mock(EventCreateWorkflowOperations, {
			processGlobalReference: () => Effect.void,
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

		expect(result).toEqual({ count: 1 });
		expect(activityNames).toEqual(["prepare-item-0", "write-event-0", "resolve-after-triggers"]);
		expect(createdEventInputs).toHaveLength(1);
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
			processGlobalReference: () => Effect.void,
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

		expect(result).toEqual({ count: 0 });
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
			processGlobalReference: () => Effect.void,
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

		expect(result).toEqual({ count: 1 });
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
			processGlobalReference: () => Effect.void,
			processSandboxExecution: () =>
				Effect.succeed({ ...completedSandboxResult(null), error: "test_error" }),
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
