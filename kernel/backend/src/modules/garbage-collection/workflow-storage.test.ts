import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { Clock, Effect, Exit, Layer, Option, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { DurableDeferred, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { workflowExecution } from "#lib/infrastructure/db/schema/tables/workflow-executions";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { WorkflowGarbageCollector } from "./workflows";

const Child = Workflow.make("GarbageCollectionChildWorkflow", {
	error: Schema.Never,
	success: Schema.String,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Parent = Workflow.make("GarbageCollectionParentWorkflow", {
	error: Schema.Never,
	success: Schema.String,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const finish = DurableDeferred.make("finish-gc-parent", {
	error: Schema.Never,
	success: Schema.String,
});

const withRuntime = Effect.fnUntraced(function* <A, E, R, Services, LayerError, Dependencies>(
	runtime: Layer.Layer<Services, LayerError, Dependencies>,
	operation: Effect.Effect<A, E, R>,
) {
	const services = yield* Layer.build(runtime);
	return yield* operation.pipe(Effect.provideContext(services));
}, Effect.scoped);

const waitForSuspension = Effect.fnUntraced(function* (executionId: string) {
	const engine = yield* WorkflowEngine;
	for (;;) {
		const result = yield* engine.poll(Parent, executionId);
		if (Option.isSome(result) && result.value._tag === "Suspended") {
			return;
		}
		yield* Effect.sleep("10 millis");
	}
});

layer(
	Layer.effectContext(TestClock.withLive(Layer.build(isolatedDatabaseLayer("workflow_gc_engine")))),
)((test) => {
	test.effect(
		"recovers a suspended parent across engine restart and rejects execution after GC",
		() =>
			Effect.gen(function* () {
				const liveClock = yield* Clock.Clock;
				const database = yield* IsolatedDatabase;
				const childRuns = yield* Ref.make(0);
				const parentRuns = yield* Ref.make(0);
				const infrastructure = Layer.effectContext(
					Layer.build(
						WorkflowGarbageCollector.layer.pipe(
							Layer.provideMerge(WorkflowEngineLive),
							Layer.provideMerge(DatabaseSession.layer),
							Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(database.url) } })),
							Layer.provide(BunServices.layer),
						),
					).pipe(Effect.provideService(Clock.Clock, liveClock)),
				);
				const definitions = Layer.mergeAll(
					implementWorkflow(Child, () =>
						Ref.update(childRuns, (count) => count + 1).pipe(Effect.as("child")),
					),
					implementWorkflow(Parent, (_payload, executionId) =>
						Effect.gen(function* () {
							yield* Ref.update(parentRuns, (count) => count + 1);
							yield* (yield* WorkflowEngine).execute(Child, {
								payload: { id: "child" },
								executionId: `${executionId}-child`,
							});
							return yield* DurableDeferred.await(finish);
						}),
					),
				).pipe(Layer.provideMerge(infrastructure));
				const executionId = "restart-parent";
				yield* withRuntime(
					definitions,
					Effect.gen(function* () {
						yield* (yield* WorkflowEngine).execute(Parent, {
							executionId,
							discard: true,
							payload: { id: "parent" },
						});
						yield* waitForSuspension(executionId);
					}),
				);
				expect(yield* Ref.get(childRuns)).toBe(1);
				yield* withRuntime(
					Layer.merge(infrastructure, TestClock.layer()),
					Effect.gen(function* () {
						const collector = yield* WorkflowGarbageCollector;
						yield* TestClock.setTime((yield* liveClock.currentTimeMillis) + 8 * 86_400_000);
						expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
					}),
				);
				yield* withRuntime(
					definitions,
					Effect.gen(function* () {
						yield* (yield* WorkflowEngine).deferredDone(finish, {
							executionId,
							workflowName: Parent._tag,
							deferredName: finish.name,
							exit: Exit.succeed("finished"),
						});
						expect(
							yield* (yield* WorkflowEngine).execute(Parent, {
								executionId,
								payload: { id: "parent" },
							}),
						).toBe("finished");
					}),
				);
				expect(yield* Ref.get(childRuns)).toBe(1);
				const runsBeforeGc = yield* Ref.get(parentRuns);
				yield* withRuntime(
					Layer.merge(infrastructure, TestClock.layer()),
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const rows = yield* session.run((db) => db.select().from(workflowExecution));
						expect(rows).toHaveLength(2);
						expect(rows.every(({ status }) => status === "succeeded")).toBe(true);
						const completedAt = Math.max(...rows.map((row) => row.completedAt?.getTime() ?? 0));
						yield* TestClock.setTime(completedAt + 86_400_000);
						expect(yield* (yield* WorkflowGarbageCollector).runBatch()).toEqual({
							expiredTrees: 1,
							clearedExecutions: 2,
						});
					}),
				);
				const expired = yield* Effect.exit(
					withRuntime(
						definitions,
						Effect.flatMap(WorkflowEngine, (engine) =>
							engine.execute(Parent, { executionId, payload: { id: "parent" } }),
						),
					),
				);
				assert(Exit.isFailure(expired));
				expect(yield* Ref.get(parentRuns)).toBe(runsBeforeGc);
				expect(yield* Ref.get(childRuns)).toBe(1);
			}).pipe(TestClock.withLive),
	);
});
