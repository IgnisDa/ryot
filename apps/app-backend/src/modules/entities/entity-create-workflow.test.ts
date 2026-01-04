import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { AutomationRuleId, EntityId, EntitySchemaId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { AutomationsRepository } from "#modules/automations/repository";

import { EntityCreateWorkflow, type EntityCreateWorkflowPayload } from "./entity-create-workflow";
import { runEntityCreateWorkflow } from "./entity-create-workflow-live";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const ruleId = AutomationRuleId.make("workout-detector");
const entitySchemaId = EntitySchemaId.make("workout-schema");
const secondRuleId = AutomationRuleId.make("workout-notifier");

const createdEntity = {
	createdAt: now,
	entitySchemaId,
	updatedAt: now,
	name: "Push Day",
	externalId: null,
	populatedAt: null,
	sandboxScriptId: null,
	id: EntityId.make("workout-1"),
	properties: { intensity: "high" },
} satisfies ListedEntity;

const payload = {
	executionId: "exec-1",
	userId: UserId.make("user-id"),
	origin: { kind: "api" as const },
	body: { entitySchemaId, name: "Push Day", properties: { intensity: "high" } },
} satisfies EntityCreateWorkflowPayload;

const createOutcome = (operation: "create" | "update" | "noop") => ({
	operation,
	entity: createdEntity,
	entitySchemaSlug: "workout",
});

type TestLayerOptions = {
	rules?: { id: AutomationRuleId }[];
	operation?: "create" | "update" | "noop";
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

const runWithHarness = (options: TestLayerOptions, executionId: string, captured: unknown[]) => {
	const instance = WorkflowInstance.initial(EntityCreateWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute:
			options.execute ??
			((_workflow, execOptions) => {
				captured.push(execOptions);
				return Effect.void;
			}),
	});

	const services = Layer.mergeAll(
		dbRunnerLayer,
		Layer.mock(EntitiesService, {
			_tag: "EntitiesService",
			create: () => Effect.succeed(createOutcome(options.operation ?? "create")),
		}),
		Layer.mock(AutomationsRepository, {
			_tag: "AutomationsRepository",
			listLifecycleSubscriptions: () =>
				Effect.succeed(options.rules ?? [{ id: ruleId }, { id: secondRuleId }]),
		}),
	);

	return runEntityCreateWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(services),
	);
};

it.effect("dispatches one subscription child per resolved rule for a create outcome", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const entity = yield* runWithHarness({}, payload.executionId, captured);

		expect(entity.id).toBe("workout-1");
		expect(captured).toHaveLength(2);
		expect(captured[0]).toMatchObject({
			discard: true,
			executionId: "lifecycle-subscription-entity-create-workout-1-workout-detector",
			payload: {
				ruleId,
				executionUserId: payload.userId,
				correlationId: "entity-create-workout-1",
				automation: {
					automationDepth: 1,
					operation: "create",
					origin: { kind: "api" },
					occurrenceId: "entity-create-workout-1",
					source: {
						kind: "entity",
						after: {
							entitySchemaId,
							id: "workout-1",
							name: "Push Day",
							entitySchemaSlug: "workout",
							properties: { intensity: "high" },
						},
					},
				},
			},
		});
		expect(captured[1]).toMatchObject({
			executionId: "lifecycle-subscription-entity-create-workout-1-workout-notifier",
			payload: { ruleId: secondRuleId, correlationId: "entity-create-workout-1" },
		});
	});
});

it.effect("dispatches no subscription children for a noop outcome", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const entity = yield* runWithHarness({ operation: "noop" }, payload.executionId, captured);

		expect(entity.id).toBe("workout-1");
		expect(captured).toHaveLength(0);
	});
});

it.effect("produces identical child execution ids when the body replays", () => {
	const first: unknown[] = [];
	const second: unknown[] = [];

	return Effect.gen(function* () {
		yield* runWithHarness({}, payload.executionId, first);
		yield* runWithHarness({}, payload.executionId, second);

		expect(first).toEqual(second);
		expect(first[0]).toMatchObject({
			executionId: "lifecycle-subscription-entity-create-workout-1-workout-detector",
		});
		expect(first[1]).toMatchObject({
			executionId: "lifecycle-subscription-entity-create-workout-1-workout-notifier",
		});
	});
});

it.effect("propagates a dispatch admission failure without swallowing it", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runWithHarness(
				{ rules: [{ id: ruleId }], execute: () => Effect.fail(new DbError({ message: "boom" })) },
				payload.executionId,
				captured,
			),
		);

		expect(exit._tag).toBe("Failure");
	});
});
