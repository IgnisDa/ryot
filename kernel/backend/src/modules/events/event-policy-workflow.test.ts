import { expect, it } from "@effect/vitest";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	UserId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { LifecycleDispatchNoop } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import {
	PluginRuntimeResolver,
	type ResolvedAutomationRule,
} from "#modules/plugins/runtime-resolver";

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
const entitySchemaSlug = EntitySchemaSlug.make("record");
const registry = makeDefinitionRegistry({
	savedViews: [],
	signalSchemas: [],
	relationshipSchemas: [],
	entitySchemas: [
		{
			icon: "record",
			name: "Record",
			pluginSlug: "test",
			slug: entitySchemaSlug,
			pluginId: "private-plugin-id",
			propertiesSchema: { fields: {} },
			eventSchemas: [
				{
					name: "Review",
					slug: eventSchemaSlug,
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Rating",
								description: "Rating",
								validation: { required: true },
							},
						},
					},
				},
			],
		},
	],
});
const eventSchemasRepository = EventSchemasRepository.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(DefinitionRegistry, { ...registry }),
			Layer.mock(PluginRuntimeResolver)({
				getEffectiveDefinitions: () => Effect.succeed(registry.getSnapshot()),
			}),
		),
	),
);

const policy = (id: string, position: number): ResolvedAutomationRule => ({
	userId,
	position,
	name: id,
	kind: "policy",
	metadata: null,
	isActive: true,
	isBuiltin: false,
	operation: "create",
	id: AutomationRuleId.make(id),
	target: { id: eventSchemaSlug, kind: "event_schema" },
	sandboxScriptId: SandboxScriptId.make(`script-${id}`),
});

const payload = (ratings: number[]): EventCreateWorkflowPayload => ({
	userId,
	origin: "api",
	lifecycleOrigin: { kind: "api" },
	executionId: "event-policy-execution",
	payload: ratings.map((rating) => ({
		entityId,
		eventSchemaSlug,
		occurredAt: now,
		properties: { rating },
	})),
});

const run = (input: {
	policies: ResolvedAutomationRule[];
	payload: EventCreateWorkflowPayload;
	isEntityReadable?: (entityId: EntityId) => boolean;
	process: (payload: SandboxExecutionPayload) => unknown;
}) => {
	const created: unknown[] = [];
	const sandboxPayloads: SandboxExecutionPayload[] = [];
	const instance = WorkflowInstance.initial(EventCreateWorkflow, input.payload.executionId);
	let engine: WorkflowEngine["Service"];
	engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);
				return new Workflow.Complete({ exit });
			}),
	});

	const layer = Layer.mergeAll(
		databaseLayer,
		LifecycleDispatchNoop,
		Layer.mock(AutomationsService, { resolveActivePolicies: () => Effect.succeed(input.policies) }),
		Layer.mock(EventCreateWorkflowOperations, {
			dispatchLifecycleOccurrence: () => Effect.void,
			executeSandboxScript: (sandboxPayload) => {
				sandboxPayloads.push(sandboxPayload);
				return Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: input.process(sandboxPayload),
				});
			},
		}),
		Layer.mock(EntitiesRepository, {
			getEntityScopeForUser: ({ entityId: requestedId }) =>
				Effect.succeed(
					input.isEntityReadable?.(requestedId) === false
						? null
						: {
								isBuiltin: false,
								entityUserId: userId,
								entityId: requestedId,
								propertiesSchema: { fields: {} },
								entitySchemaSlug: EntitySchemaSlug.make("record"),
								entityName: requestedId === entityId ? "Dune" : "Reading session",
							},
				),
		}),
		eventSchemasRepository,
		Layer.mock(EventsRepository, {
			createEvent: (event) => {
				assert(event.id);
				created.push(event);
				return Effect.succeed({
					id: event.id,
					createdAt: now,
					updatedAt: now,
					entityId: event.entityId,
					properties: event.properties,
					eventSchemaName: event.eventSchemaName,
					eventSchemaSlug: event.eventSchemaSlug,
					sessionEntityId: event.sessionEntityId,
					occurredAt: event.occurredAt.toISOString(),
				});
			},
		}),
	);

	return {
		created,
		sandboxPayloads,
		effect: runEventCreateWorkflow(input.payload, input.payload.executionId).pipe(
			Effect.provide(layer),
			Effect.provideService(WorkflowEngine, engine),
			Effect.provideService(WorkflowInstance, instance),
		),
	};
};

it.effect("runs policies in position order and validates each replacement before the next", () => {
	const sessionEntityId = EntityId.make("session-1");
	const test = run({
		payload: payload([1]),
		policies: [policy("late", 20), policy("early", 10)],
		process: (sandboxPayload) =>
			sandboxPayload.executionId.includes("early")
				? {
						action: "replace",
						body: {
							sessionEntityId,
							properties: { rating: 10 },
							occurredAt: "2026-02-02T00:00:00.000Z",
						},
					}
				: { action: "allow" },
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(result.count).toBe(1);
		expect(test.sandboxPayloads.map(({ executionId }) => executionId)).toEqual([
			"event-policy-execution-policy-0-early",
			"event-policy-execution-policy-0-late",
		]);
		expect(test.sandboxPayloads[0]?.context).not.toHaveProperty(
			"automation.source.draft.sessionEntityId",
		);
		expect(test.sandboxPayloads[1]?.context).toMatchObject({
			automation: {
				source: {
					draft: {
						sessionEntityId,
						properties: { rating: 10 },
						occurredAt: "2026-02-02T00:00:00.000Z",
					},
				},
			},
		});
		expect(test.sandboxPayloads[0]?.subject).toEqual({
			userId,
			type: "subscription",
			subscriptionRun: {
				occurredAt: now,
				origin: { kind: "api" },
				id: "event-policy-execution-policy-0-early",
			},
		});
		expect(test.created[0]).toMatchObject({
			sessionEntityId,
			properties: { rating: 10 },
			eventSchemaPluginId: "private-plugin-id",
		});
	});
});

it.effect("skips policies that do not apply to the event origin", () => {
	const test = run({
		payload: payload([1]),
		process: () => ({ action: "allow" }),
		policies: [{ ...policy("integration-only", 10), metadata: { origins: ["integration"] } }],
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(result.count).toBe(1);
		expect(test.created).toHaveLength(1);
		expect(test.sandboxPayloads).toHaveLength(0);
	});
});

it.effect("runs subject-batched policies once per subject in an event-create payload", () => {
	const otherEntityId = EntityId.make("entity-2");
	const batchedPayload = payload([1, 2, 3]);
	const first = batchedPayload.payload[0];
	const second = batchedPayload.payload[1];
	const third = batchedPayload.payload[2];
	assert(first);
	assert(second);
	assert(third);
	const test = run({
		process: () => ({ action: "allow" }),
		policies: [{ ...policy("subject-batched", 10), metadata: { batchMode: "subject" } }],
		payload: { ...batchedPayload, payload: [first, second, { ...third, entityId: otherEntityId }] },
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(result.count).toBe(3);
		expect(test.created).toHaveLength(3);
		expect(test.sandboxPayloads).toHaveLength(2);
	});
});

it.effect("keeps earlier writes when a later policy replacement is invalid", () => {
	const test = run({
		payload: payload([1, 2]),
		policies: [policy("validator", 10)],
		process: (sandboxPayload) =>
			JSON.stringify(sandboxPayload.context).includes('"rating":2')
				? { action: "replace", body: { properties: { rating: "invalid" } } }
				: { action: "allow" },
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(test.created).toHaveLength(1);
		expect(result.count).toBe(1);
		expect(result.outcomes).toHaveLength(1);
		expect(result.failure).toEqual({ index: 1, reason: { code: "invalid-properties" } });
	});
});

it.effect("reauthorizes a replacement session entity", () => {
	const inaccessibleId = EntityId.make("inaccessible-session");
	const test = run({
		payload: payload([1]),
		policies: [policy("replace-session", 10)],
		isEntityReadable: (requestedId) => requestedId !== inaccessibleId,
		process: () => ({ action: "replace", body: { sessionEntityId: inaccessibleId } }),
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(test.created).toHaveLength(0);
		expect(result.failure).toEqual({
			index: 0,
			reason: { entityId: inaccessibleId, code: "session-entity-not-found" },
		});
	});
});

it.effect("rejects replacement fields outside the event-create policy contract", () => {
	const test = run({
		payload: payload([1]),
		policies: [policy("replace-fixed-field", 10)],
		process: () => ({
			action: "replace",
			body: { entityId: "other-entity", properties: { rating: 2 } },
		}),
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(test.created).toHaveLength(0);
		expect(result.failure).toEqual({ index: 0, reason: { code: "policy-failed" } });
	});
});

it.effect("returns a policy skip as a successful item outcome", () => {
	const test = run({
		payload: payload([1]),
		policies: [policy("skip", 10)],
		process: () => ({ action: "skip", reason: "duplicate" }),
	});

	return Effect.gen(function* () {
		const result = yield* test.effect;
		expect(test.created).toHaveLength(0);
		expect(result).toEqual({
			count: 0,
			failure: null,
			outcomes: [{ index: 0, reason: "duplicate", status: "skipped_by_policy" }],
		});
	});
});
