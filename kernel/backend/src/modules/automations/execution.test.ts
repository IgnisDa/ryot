import { expect } from "bun:test";

import { AutomationHookSlug, AutomationRunId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePersistenceError } from "#modules/automations/lifecycle/planning";
import { DatabaseSession } from "#platform/db/session";
import { databaseLayer } from "#testing/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import {
	AutomationExecutionOperations,
	AutomationExecutionOperationsLive,
	LifecycleExecutionLive,
} from "./execution";
import { queuedRunFixture, triggerFixture } from "./lifecycle.test-support";
import { recordingRunJobQueueLayer, RunJobSubmissions } from "./run-job-queue.test-support";
import { AutomationRunRepository } from "./run-repository";

const trigger = triggerFixture();

const dispatchRun = (id: string, status: "queued" | "skipped" = "queued") => ({
	status,
	triggerId: trigger.id,
	stage: "after" as const,
	id: AutomationRunId.make(id),
	hookSlug: AutomationHookSlug.make("fixture"),
});

layer(
	LifecycleExecutionLive.pipe(
		Layer.provideMerge(AutomationExecutionOperationsLive),
		Layer.provide(
			Layer.mock(AutomationRunRepository)({
				findById: (id) => Effect.succeed(queuedRunFixture(id)),
				listDispatchStates: (ids) =>
					Effect.succeed(
						(
							[
								{ id: "claimed", attemptCount: 1, status: "running" },
								{ id: "retried", attemptCount: 1, status: "queued" },
								{ id: "fresh", attemptCount: 0, status: "queued" },
								{ id: "other", attemptCount: 0, status: "queued" },
								{ id: "skipped", attemptCount: 0, status: "skipped" },
							] as const
						).filter(({ id }) => ids.includes(AutomationRunId.make(id))),
					),
			}),
		),
		Layer.provideMerge(databaseLayer),
		Layer.provideMerge(recordingRunJobQueueLayer),
	),
)((test) => {
	test.effect(
		"only treats runs that were never claimed and are still queued as unsubmitted",
		() =>
			Effect.gen(function* () {
				const runIds = ["claimed", "retried", "fresh", "skipped", "missing"].map((id) =>
					AutomationRunId.make(id),
				);
				const states = yield* (yield* AutomationExecutionOperations).dispatchStates(runIds);
				expect(runIds.map((id) => states.get(id))).toEqual([
					{ state: "claimed" },
					{ state: "claimed" },
					{ state: "fresh" },
					{ state: "closed" },
					{ state: "closed" },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"queues each fresh after hook of a committed write as one keyed job",
		() =>
			Effect.gen(function* () {
				yield* (yield* LifecycleExecution).dispatch([
					{
						blockedReason: null,
						triggerId: trigger.id,
						runs: [
							dispatchRun("fresh"),
							dispatchRun("claimed"),
							dispatchRun("skipped", "skipped"),
							{ ...dispatchRun("other"), triggerId: triggerFixture("trigger-other").id },
						],
					},
				]);
				expect(yield* yield* RunJobSubmissions).toEqual<unknown>([
					{
						kind: "automation-run",
						payload: { runId: "fresh", attemptNumber: 1 },
						key: automationAttemptIdentity(AutomationRunId.make("fresh"), 1).executionId,
					},
				]);
			}),
		testTimeout,
	);

	test.effect(
		"dispatches only after the source transaction commits",
		() =>
			Effect.gen(function* () {
				const exit = yield* (yield* DatabaseSession)
					.transaction((yield* LifecycleExecution).dispatch([]))
					.pipe(Effect.exit);
				assertExitFails(exit, new LifecyclePersistenceError({ code: "postcommit-requires-root" }));
			}),
		testTimeout,
	);
});
