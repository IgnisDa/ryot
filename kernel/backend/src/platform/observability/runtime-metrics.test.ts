import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Metric } from "effect";

import { recordSandboxWorkflowReplayFinished } from "./runtime-metrics";

const withIsolatedRegistry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, Metric.MetricRegistry, new Map());

const findSnapshot = (id: string, attributes: Record<string, string>) =>
	Effect.map(Metric.snapshot, (snapshots) =>
		snapshots.find(
			(snapshot) =>
				snapshot.id === id &&
				Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
		),
	);

describe("backend runtime metrics", () => {
	it.effect(
		"records a replay outcome and journal size",
		() =>
			withIsolatedRegistry(
				Effect.gen(function* () {
					yield* recordSandboxWorkflowReplayFinished({
						durationMs: 12,
						kind: "workflow",
						journalEntries: 1,
						journalBytes: 512,
						outcome: "pending",
					});
					const replays = yield* findSnapshot("ryot.sandbox.workflow_replays", {
						kind: "workflow",
						outcome: "pending",
					});
					const journal = yield* findSnapshot("ryot.sandbox.workflow_journal_size", {
						kind: "workflow",
					});
					expect(replays?.state).toMatchObject({ count: 1 });
					expect(journal?.state).toMatchObject({ count: 1, sum: 512 });
				}),
			),
		testTimeout,
	);
});
