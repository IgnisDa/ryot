import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import { AutomationRuleId, EntityId, EntitySchemaId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine, transactionLayer } from "#lib/test-support/effect";
import { AutomationsRepository } from "#modules/automations/repository";
import { EntitiesService } from "#modules/entities/service";

import {
	BootstrapUserWorkflow,
	type BootstrapUserWorkflowPayload,
} from "./bootstrap-user-workflow";
import { runBootstrapUserWorkflow } from "./bootstrap-user-workflow-live";

const now = "2026-06-14T00:00:00.000Z";

const entityId = EntityId.make("library-1");
const ruleId = AutomationRuleId.make("library-detector");
const entitySchemaId = EntitySchemaId.make("library-schema");
const secondRuleId = AutomationRuleId.make("library-notifier");

const envelope = {
	entitySchemaId,
	entitySchemaSlug: "library",
	entity: { id: entityId, name: "Library", createdAt: now, properties: {} },
};

const payload = {
	executionId: "exec-1",
	userId: UserId.make("user-id"),
} satisfies BootstrapUserWorkflowPayload;

type TestLayerOptions = {
	rules?: { id: AutomationRuleId }[];
	activityExit?: Exit.Exit<typeof envelope | null, DbError>;
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

const runWithHarness = (options: TestLayerOptions, executionId: string, captured: unknown[]) => {
	const instance = WorkflowInstance.initial(BootstrapUserWorkflow, executionId);

	let engine: WorkflowEngine["Type"];
	engine = makeWorkflowEngine({
		execute:
			options.execute ??
			((_workflow, execOptions) => {
				captured.push(execOptions);
				return Effect.void;
			}),
		activityExecute: (activity) =>
			activity.name === "bootstrap-user"
				? Effect.succeed(
						new Workflow.Complete({ exit: options.activityExit ?? Exit.succeed(envelope) }),
					)
				: Effect.gen(function* () {
						const exit = yield* Effect.exit(
							activity.execute.pipe(
								Effect.provideService(WorkflowEngine, engine),
								Effect.provideService(WorkflowInstance, instance),
							),
						);
						return new Workflow.Complete({ exit });
					}),
	});

	const services = Layer.mergeAll(
		dbRunnerLayer,
		transactionLayer,
		Layer.mock(EntitiesService, {
			_tag: "EntitiesService",
			create: () => Effect.die("unused"),
		}),
		Layer.mock(AutomationsRepository, {
			_tag: "AutomationsRepository",
			listLifecycleSubscriptions: () =>
				Effect.succeed(options.rules ?? [{ id: ruleId }, { id: secondRuleId }]),
		}),
	);

	return runBootstrapUserWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(services),
	);
};

it.effect("dispatches one subscription child per resolved rule for a returned envelope", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		yield* runWithHarness({}, payload.executionId, captured);

		expect(captured).toHaveLength(2);
		expect(captured[0]).toMatchObject({
			discard: true,
			executionId: "lifecycle-subscription-entity-create-library-1-library-detector",
			payload: {
				ruleId,
				executionUserId: payload.userId,
				correlationId: "entity-create-library-1",
				automation: {
					automationDepth: 1,
					operation: "create",
					origin: { kind: "bootstrap" },
					occurrenceId: "entity-create-library-1",
					source: {
						kind: "entity",
						after: {
							properties: {},
							entitySchemaId,
							id: "library-1",
							name: "Library",
							entitySchemaSlug: "library",
						},
					},
				},
			},
		});
		expect(captured[1]).toMatchObject({
			executionId: "lifecycle-subscription-entity-create-library-1-library-notifier",
			payload: { ruleId: secondRuleId, correlationId: "entity-create-library-1" },
		});
	});
});

it.effect("dispatches no subscription children when no library entity was created", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		yield* runWithHarness({ activityExit: Exit.succeed(null) }, payload.executionId, captured);

		expect(captured).toHaveLength(0);
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
