import { expect } from "bun:test";

import { BunCrypto, BunServices } from "@effect/platform-bun";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { DatabaseSession } from "#platform/db/session";
import { WorkflowEngineStore } from "#platform/workflow/engine-store";
import type { WorkflowIdentity } from "#platform/workflow/identity";
import { workflowExecution } from "#schema/tables/workflow-executions";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { WorkflowGarbageCollectionRepository } from "./workflow-repository";
import { WorkflowGarbageCollector } from "./workflows";

const admit = Effect.fnUntraced(function* (identity: WorkflowIdentity, parent?: WorkflowIdentity) {
	return yield* (yield* WorkflowEngineStore).admit({
		parent,
		identity,
		account: undefined,
		payload: { input: identity.executionId },
	});
});

const finish = Effect.fnUntraced(function* (identity: WorkflowIdentity, succeeded: boolean) {
	yield* (yield* WorkflowEngineStore).complete({
		identity,
		succeeded,
		result: { _tag: "Complete" },
		completedAt: DateTime.toDate(yield* DateTime.now),
	});
});

const write = Effect.fnUntraced(function* (
	identity: WorkflowIdentity,
	kind: "clock" | "activity" | "deferred",
	name: string,
) {
	return yield* (yield* WorkflowEngineStore).writeStep({
		kind,
		name,
		identity,
		attempt: 0,
		exit: kind === "clock" ? undefined : { _tag: "Success" },
		...(kind === "clock"
			? { fireAt: DateTime.toDate(DateTime.makeUnsafe("2030-01-01T00:00:00Z")) }
			: {}),
	});
});

const storedRow = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
	const [row] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select()
			.from(workflowExecution)
			.where(
				and(
					eq(workflowExecution.workflowName, identity.workflowName),
					eq(workflowExecution.executionId, identity.executionId),
				),
			),
	);
	return row;
});

const stepCount = Effect.fnUntraced(function* (identity: WorkflowIdentity) {
	const [row] = yield* (yield* DatabaseSession).run((db) =>
		db.execute<{ steps: number }>(
			sql`select count(*)::integer as steps from workflow_step
			where workflow_name = ${identity.workflowName} and execution_id = ${identity.executionId}`,
			"objects",
		),
	);
	return row?.steps;
});

const collectorLayer = WorkflowGarbageCollector.layer.pipe(
	Layer.provideMerge(WorkflowGarbageCollectionRepository.layer),
	Layer.provideMerge(WorkflowEngineStore.layer),
	Layer.provideMerge(isolatedDatabaseLayer("workflow_gc")),
	Layer.provide(BunServices.layer),
);

layer(
	Layer.provideMerge(
		Layer.effectContext(TestClock.withLive(Layer.build(collectorLayer))),
		BunCrypto.layerSecureRandom,
	),
)((test) => {
	test.effect(
		"clears successful steps after 24 hours and fences late writes",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-10-02T00:00:00Z"));
				const identity = { executionId: "success", workflowName: "SuccessWorkflow" };
				const collector = yield* WorkflowGarbageCollector;
				yield* admit(identity);
				yield* write(identity, "activity", "load");
				yield* write(identity, "deferred", "signal");
				yield* (yield* WorkflowEngineStore).saveCheckpoint(identity, { offset: 2 }, "completed/");
				yield* finish(identity, true);
				yield* TestClock.adjust("23 hours");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				expect(yield* stepCount(identity)).toBe(2);
				expect((yield* storedRow(identity))?.checkpoint).toEqual({ offset: 2 });
				yield* TestClock.adjust("1 hour");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 1 });
				expect(yield* stepCount(identity)).toBe(0);
				expect(yield* write(identity, "deferred", "late")).toMatchObject({
					written: false,
					rootExpired: true,
				});
				const resubmitted = yield* admit(identity);
				expect(resubmitted.inserted).toBe(false);
				expect(resubmitted.row?.rootExpired).toBe(true);
				const row = yield* storedRow(identity);
				expect(row).toMatchObject({
					result: null,
					payload: null,
					checkpoint: null,
					status: "succeeded",
				});
				expect(row?.expiredAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
				expect(row?.clearedAt?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
			}),
		testTimeout,
	);

	test.effect(
		"keeps completed children while a parent is active and starts TTL at tree completion",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-10-10T00:00:00Z"));
				const parent = { executionId: "parent", workflowName: "ParentWorkflow" };
				const child = { executionId: "child", workflowName: "ChildWorkflow" };
				yield* admit(parent);
				yield* admit(child, parent);
				yield* finish(child, true);
				yield* TestClock.adjust("8 days");
				const collector = yield* WorkflowGarbageCollector;
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* finish(parent, true);
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* TestClock.adjust("24 hours");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			}),
		testTimeout,
	);

	test.effect(
		"keeps a tree with a failed child for seven days even if its root succeeds",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T00:00:00Z"));
				const parent = { executionId: "failure-parent", workflowName: "ParentWorkflow" };
				const child = { executionId: "failure-child", workflowName: "ChildWorkflow" };
				yield* admit(parent);
				yield* admit(child, parent);
				yield* finish(child, false);
				yield* finish(parent, true);
				yield* TestClock.adjust("6 days");
				const collector = yield* WorkflowGarbageCollector;
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* TestClock.adjust("1 day");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			}),
		testTimeout,
	);

	test.effect(
		"expires failed trees after 168 elapsed hours across DST transitions",
		() =>
			Effect.gen(function* () {
				const cases = [
					{ timeZone: "Europe/Berlin", completedAt: "2026-03-25T06:00:00Z" },
					{ timeZone: "Europe/Berlin", completedAt: "2026-10-22T06:00:00Z" },
					{ timeZone: "Australia/Lord_Howe", completedAt: "2026-10-01T06:00:00Z" },
				];
				const session = yield* DatabaseSession;
				const repository = yield* WorkflowGarbageCollectionRepository;
				const expireIn = (timeZone: string, now: DateTime.Utc) =>
					session.transaction(
						Effect.gen(function* () {
							yield* session.run((db) =>
								db.execute(sql`select set_config('TimeZone', ${timeZone}, true)`),
							);
							return yield* repository.expireTrees(DateTime.toDateUtc(now), 100);
						}),
					);
				for (const fixture of cases) {
					const completedAt = DateTime.makeUnsafe(fixture.completedAt);
					yield* TestClock.setTime(DateTime.toEpochMillis(completedAt));
					const identity = { executionId: yield* randomUuid, workflowName: "DstRetentionWorkflow" };
					yield* admit(identity);
					yield* finish(identity, false);
					const expiresAt = DateTime.add(completedAt, { hours: 168 });
					expect(
						yield* expireIn(fixture.timeZone, DateTime.subtract(expiresAt, { seconds: 1 })),
					).toBe(0);
					expect(yield* expireIn(fixture.timeZone, expiresAt)).toBe(1);
					const row = yield* storedRow(identity);
					expect(row?.expiredAt?.toISOString()).toBe(DateTime.formatIso(expiresAt));
					yield* TestClock.setTime(DateTime.toEpochMillis(expiresAt));
					yield* (yield* WorkflowGarbageCollector).runBatch();
				}
			}),
		testTimeout,
	);

	test.effect(
		"does not collect a successful root while a discarded child remains active",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-12-01T00:00:00Z"));
				const parent = { executionId: "discard-parent", workflowName: "ParentWorkflow" };
				const child = { executionId: "discard-child", workflowName: "ChildWorkflow" };
				yield* admit(parent);
				yield* admit(child, parent);
				yield* finish(parent, true);
				yield* TestClock.adjust("8 days");
				const collector = yield* WorkflowGarbageCollector;
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* finish(child, true);
				yield* TestClock.adjust("24 hours");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 2 });
			}),
		testTimeout,
	);

	test.effect(
		"keeps a terminal tree with an unfired durable clock",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2027-01-01T00:00:00Z"));
				const identity = { executionId: "pending-clock", workflowName: "PendingWorkflow" };
				yield* admit(identity);
				yield* write(identity, "clock", "sleep");
				yield* finish(identity, true);
				yield* TestClock.adjust("8 days");
				const collector = yield* WorkflowGarbageCollector;
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 0, clearedExecutions: 0 });
				yield* (yield* WorkflowEngineStore).fireClock(identity, "sleep");
				expect(yield* collector.runBatch()).toEqual({ expiredTrees: 1, clearedExecutions: 1 });
				expect(yield* stepCount(identity)).toBe(0);
			}),
		testTimeout,
	);

	test.effect(
		"serializes child admission with tree expiry",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2027-03-01T00:00:00Z"));
				const root = { executionId: "race-root", workflowName: "RaceRootWorkflow" };
				const child = { executionId: "race-child", workflowName: "RaceChildWorkflow" };
				yield* admit(root);
				yield* finish(root, true);
				yield* TestClock.adjust("24 hours");
				const session = yield* DatabaseSession;
				const repository = yield* WorkflowGarbageCollectionRepository;
				const expired = yield* Deferred.make<number>();
				const release = yield* Deferred.make<void>();
				const expiry = yield* Effect.forkScoped(
					session.transaction(
						Effect.gen(function* () {
							const now = DateTime.toDate(yield* DateTime.now);
							yield* Deferred.succeed(expired, yield* repository.expireTrees(now, 10));
							yield* Deferred.await(release);
						}),
					),
				);
				expect(yield* Deferred.await(expired)).toBe(1);
				const admission = yield* Effect.forkScoped(admit(child, root));
				yield* TestClock.withLive(Effect.sleep("200 millis"));
				expect(admission.pollUnsafe()).toBeUndefined();
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(expiry);
				const admitted = yield* Fiber.join(admission);
				expect(admitted).toEqual({ row: undefined, inserted: false, rejected: false });
			}),
		testTimeout,
	);

	test.effect(
		"rejects new descendants and step writes for an expired tree",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2027-04-01T00:00:00Z"));
				const identity = { executionId: "expired-parent", workflowName: "ExpiredParentWorkflow" };
				yield* admit(identity);
				yield* finish(identity, true);
				yield* TestClock.adjust("24 hours");
				yield* (yield* WorkflowGarbageCollector).runBatch();
				const child = { workflowName: "ChildWorkflow", executionId: "expired-new-child" };
				expect(yield* admit(child, identity)).toEqual({
					row: undefined,
					inserted: false,
					rejected: false,
				});
				expect(yield* storedRow(child)).toBeUndefined();
				for (const kind of ["activity", "clock", "deferred"] as const) {
					expect(yield* write(identity, kind, "late")).toMatchObject({
						written: false,
						rootExpired: true,
					});
				}
				expect(yield* stepCount(identity)).toBe(0);
			}),
		testTimeout,
	);

	test.effect(
		"keeps a child in its first tree and admits nothing under a missing parent",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2027-06-01T00:00:00Z"));
				const first = { executionId: "first-root", workflowName: "RootWorkflow" };
				const second = { executionId: "second-root", workflowName: "RootWorkflow" };
				const child = { executionId: "shared-child", workflowName: "ChildWorkflow" };
				yield* admit(first);
				yield* admit(second);
				yield* admit(child, first);
				expect((yield* admit(child, second)).row?.rootExecutionId).toBe(first.executionId);
				const orphan = { executionId: "orphan", workflowName: "ChildWorkflow" };
				const missing = { workflowName: "RootWorkflow", executionId: "missing-parent" };
				expect(yield* admit(orphan, missing)).toEqual({
					row: undefined,
					inserted: false,
					rejected: false,
				});
				expect(yield* write(orphan, "deferred", "signal")).toMatchObject({
					written: false,
					admitted: false,
				});
			}),
		testTimeout,
	);
});
