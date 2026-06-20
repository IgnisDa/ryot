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
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	EnableMediaMonitoringWorkflow,
	type EnableMediaMonitoringWorkflowPayload,
} from "./enable-media-monitoring-workflow";
import { runEnableMediaMonitoringWorkflow } from "./enable-media-monitoring-workflow-live";

const now = "2026-06-14T00:00:00.000Z";

const entityId = EntityId.make("entity-1");
const relationshipId = RelationshipId.make("rel-1");
const ruleId = AutomationRuleId.make("monitor-detector");
const secondRuleId = AutomationRuleId.make("monitor-notifier");
const relationshipSchemaId = RelationshipSchemaId.make("media-monitoring-schema");

const snapshot = (properties: Record<string, unknown>) => ({
	properties,
	id: relationshipId,
	relationshipSchemaId,
	relationshipSchemaSlug: "media-monitoring",
	source: { id: entityId, name: "Movie", entitySchemaSlug: "movie" },
	target: { id: EntityId.make("library-1"), name: "Library", entitySchemaSlug: "library" },
});

type Operation = "create" | "update" | "noop";

const writeResult = (operation: Operation) => {
	if (operation === "create") {
		return {
			operation,
			createdAt: now,
			relationshipSchemaId,
			after: snapshot({}),
		};
	}
	return { operation, relationshipSchemaId, after: snapshot({}), before: snapshot({}) };
};

const payload = {
	entityId,
	executionId: "exec-1",
	userId: UserId.make("user-id"),
} satisfies EnableMediaMonitoringWorkflowPayload;

type TestLayerOptions = {
	operation?: Operation;
	rules?: { id: AutomationRuleId }[];
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
};

const runWithHarness = (options: TestLayerOptions, executionId: string, captured: unknown[]) => {
	const instance = WorkflowInstance.initial(EnableMediaMonitoringWorkflow, executionId);

	let engine: WorkflowEngine["Type"];
	engine = makeWorkflowEngine({
		execute:
			options.execute ??
			((_workflow, execOptions) => {
				captured.push(execOptions);
				return Effect.void;
			}),
		activityExecute: (activity) =>
			activity.name === "write-media-monitoring"
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
		Layer.mock(CollectionsService, {
			_tag: "CollectionsService",
			ensureEntityInLibrary: () => Effect.die("unused"),
		}),
		Layer.mock(CollectionsRepository, {
			_tag: "CollectionsRepository",
			getUserLibraryEntityId: () => Effect.die("unused"),
		}),
		Layer.mock(RelationshipSchemasRepository, {
			_tag: "RelationshipSchemasRepository",
			findBuiltinBySlug: () => Effect.die("unused"),
		}),
		Layer.mock(AutomationsRepository, {
			_tag: "AutomationsRepository",
			listLifecycleSubscriptions: () =>
				Effect.succeed(options.rules ?? [{ id: ruleId }, { id: secondRuleId }]),
		}),
	);

	return runEnableMediaMonitoringWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(services),
	);
};

it.effect("dispatches one subscription child per resolved rule for a create outcome", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const status = yield* runWithHarness({}, payload.executionId, captured);

		expect(status).toEqual({ entityId, isMediaMonitored: true });
		expect(captured).toHaveLength(2);
		expect(captured[0]).toMatchObject({
			discard: true,
			executionId: "lifecycle-subscription-relationship-create-rel-1-monitor-detector",
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
						after: { id: "rel-1", relationshipSchemaSlug: "media-monitoring" },
					},
				},
			},
		});
		expect(captured[1]).toMatchObject({
			executionId: "lifecycle-subscription-relationship-create-rel-1-monitor-notifier",
			payload: { ruleId: secondRuleId, correlationId: "relationship-create-rel-1" },
		});
	});
});

it.effect("dispatches no subscription children for a noop re-enable", () => {
	const captured: unknown[] = [];

	return Effect.gen(function* () {
		const status = yield* runWithHarness({ operation: "noop" }, payload.executionId, captured);

		expect(status).toEqual({ entityId, isMediaMonitored: true });
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
			executionId: "lifecycle-subscription-relationship-create-rel-1-monitor-detector",
		});
		expect(first[1]).toMatchObject({
			executionId: "lifecycle-subscription-relationship-create-rel-1-monitor-notifier",
		});
	});
});
