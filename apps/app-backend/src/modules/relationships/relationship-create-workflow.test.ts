import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import {
	AutomationRuleId,
	EntityId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-support/effect";
import { AutomationsRepository } from "#modules/automations/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import {
	RelationshipCreateWorkflow,
	type RelationshipCreateWorkflowPayload,
} from "./relationship-create-workflow";
import { runRelationshipCreateWorkflow } from "./relationship-create-workflow-live";
import { RelationshipsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const sourceEntityId = EntityId.make("source-1");
const targetEntityId = EntityId.make("target-1");
const relationshipId = RelationshipId.make("rel-1");
const ruleId = AutomationRuleId.make("follow-detector");
const secondRuleId = AutomationRuleId.make("follow-notifier");
const relationshipSchemaId = RelationshipSchemaId.make("rel-schema");

const endpointTarget = { id: targetEntityId, name: "Target", entitySchemaSlug: "movie" };
const endpointSource = { id: sourceEntityId, name: "Source", entitySchemaSlug: "person" };

const snapshot = (properties: Record<string, unknown>) => ({
	properties,
	id: relationshipId,
	relationshipSchemaId,
	source: endpointSource,
	target: endpointTarget,
	relationshipSchemaSlug: "follows",
});

const response = (properties: Record<string, unknown>, wasInserted: boolean) => ({
	properties,
	wasInserted,
	createdAt: now,
	sourceEntityId,
	targetEntityId,
	id: relationshipId,
	relationshipSchemaId,
});

type Operation = "create" | "update" | "noop";

const writeResult = (operation: Operation) => {
	if (operation === "create") {
		return {
			operation,
			relationshipSchemaId,
			after: snapshot({ status: "active" }),
			response: response({ status: "active" }, true),
		};
	}
	if (operation === "update") {
		return {
			operation,
			relationshipSchemaId,
			before: snapshot({ status: "old" }),
			after: snapshot({ status: "active" }),
			response: response({ status: "active" }, false),
		};
	}
	return {
		operation,
		relationshipSchemaId,
		before: snapshot({ status: "active" }),
		after: snapshot({ status: "active" }),
		response: response({ status: "active" }, false),
	};
};

const payload = {
	executionId: "exec-1",
	userId: UserId.make("user-id"),
	origin: { kind: "api" as const },
	body: { sourceEntityId, targetEntityId, relationshipSchemaId, properties: { status: "active" } },
} satisfies RelationshipCreateWorkflowPayload;

type TestLayerOptions = {
	operation?: Operation;
	rules?: { id: AutomationRuleId }[];
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

const runWithHarness = (options: TestLayerOptions, executionId: string, captured: unknown[]) => {
	const instance = WorkflowInstance.initial(RelationshipCreateWorkflow, executionId);

	let engine: WorkflowEngine["Type"];
	engine = makeWorkflowEngine({
		execute:
			options.execute ??
			((_workflow, execOptions) => {
				captured.push(execOptions);
				return Effect.void;
			}),
		activityExecute: (activity) =>
			activity.name === "write-relationship"
				? Effect.succeed(
						new Workflow.Complete({
							exit: Exit.succeed(writeResult(options.operation ?? "create")),
						}),
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
		Layer.mock(RelationshipsService, {
			_tag: "RelationshipsService",
			save: () => Effect.die("unused"),
		}),
		Layer.mock(EntitiesRepository, {
			_tag: "EntitiesRepository",
			getEntityScopeForUser: () => Effect.die("unused"),
		}),
		Layer.mock(RelationshipSchemasRepository, {
			_tag: "RelationshipSchemasRepository",
			findById: () => Effect.die("unused"),
		}),
		Layer.mock(AutomationsRepository, {
			_tag: "AutomationsRepository",
			listLifecycleSubscriptions: () =>
				Effect.succeed(options.rules ?? [{ id: ruleId }, { id: secondRuleId }]),
		}),
	);

	return runRelationshipCreateWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(services),
	);
};

it.effect("dispatches one subscription child per resolved rule for a create outcome", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const relationship = yield* runWithHarness({}, payload.executionId, captured);

		expect(relationship.id).toBe("rel-1");
		expect(captured).toHaveLength(2);
		expect(captured[0]).toMatchObject({
			discard: true,
			executionId: "lifecycle-subscription-relationship-create-rel-1-follow-detector",
			payload: {
				ruleId,
				executionUserId: payload.userId,
				correlationId: "relationship-create-rel-1",
				automation: {
					automationDepth: 1,
					operation: "create",
					origin: { kind: "api" },
					occurrenceId: "relationship-create-rel-1",
					source: {
						kind: "relationship",
						after: {
							id: "rel-1",
							properties: { status: "active" },
							relationshipSchemaSlug: "follows",
						},
					},
				},
			},
		});
		expect(captured[1]).toMatchObject({
			executionId: "lifecycle-subscription-relationship-create-rel-1-follow-notifier",
			payload: { ruleId: secondRuleId, correlationId: "relationship-create-rel-1" },
		});
	});
});

it.effect("dispatches an update occurrence keyed by the execution id", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		yield* runWithHarness({ operation: "update" }, payload.executionId, captured);

		expect(captured).toHaveLength(2);
		expect(captured[0]).toMatchObject({
			executionId: "lifecycle-subscription-exec-1-relationship-update-rel-1-follow-detector",
			payload: {
				correlationId: "exec-1-relationship-update-rel-1",
				automation: {
					operation: "update",
					occurrenceId: "exec-1-relationship-update-rel-1",
					source: {
						kind: "relationship",
						before: { properties: { status: "old" } },
						after: { properties: { status: "active" } },
					},
				},
			},
		});
		expect(captured[0]).not.toHaveProperty("payload.automation.committedAt");
	});
});

it.effect("dispatches no subscription children for a noop outcome", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const relationship = yield* runWithHarness(
			{ operation: "noop" },
			payload.executionId,
			captured,
		);

		expect(relationship.id).toBe("rel-1");
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

it.effect("produces identical child execution ids when the body replays", () => {
	const first: unknown[] = [];
	const second: unknown[] = [];

	return Effect.gen(function* () {
		yield* runWithHarness({}, payload.executionId, first);
		yield* runWithHarness({}, payload.executionId, second);

		expect(first).toEqual(second);
		expect(first[0]).toMatchObject({
			executionId: "lifecycle-subscription-relationship-create-rel-1-follow-detector",
		});
		expect(first[1]).toMatchObject({
			executionId: "lifecycle-subscription-relationship-create-rel-1-follow-notifier",
		});
	});
});
