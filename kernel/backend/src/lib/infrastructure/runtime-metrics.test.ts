import { describe, expect, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import {
	getSandboxReplayCounters,
	recordProviderImportSettled,
	recordProviderImportStarted,
	recordSandboxExecution,
	recordSandboxHostCall,
	recordSandboxWorkflowReplayFinished,
	recordSandboxWorkflowReplayStarted,
	sandboxMetricHostFunction,
	sandboxMetricKind,
} from "./runtime-metrics";

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

describe("sandbox runtime metrics", () => {
	it("collapses unknown manifest kinds and unregistered host functions", () => {
		expect(sandboxMetricKind({ kind: "provider" })).toBe("provider");
		expect(sandboxMetricKind({ kind: "something-new" })).toBe("unknown");
		expect(sandboxMetricKind(null)).toBe("unknown");
		expect(sandboxMetricHostFunction("httpCall")).toBe("httpCall");
		expect(sandboxMetricHostFunction("replayJournal")).toBe("replayJournal");
		expect(sandboxMetricHostFunction("/../etc/passwd")).toBe("unknown");
	});

	it.effect("records an execution against its outcome and kind series", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordSandboxExecution({
					kind: "provider",
					outcome: "timeout",
					durationMs: 30_000,
					responseBytes: 2_048,
				});
				const executions = yield* findSnapshot("ryot.sandbox.executions", {
					kind: "provider",
					outcome: "timeout",
				});
				const duration = yield* findSnapshot("ryot.sandbox.execution_duration", {
					kind: "provider",
					outcome: "timeout",
				});
				expect(executions?.state).toMatchObject({ count: 1 });
				expect(duration?.state).toMatchObject({ count: 1, sum: 30_000 });
			}),
		),
	);

	it.effect("labels a host call with its bounded function name", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordSandboxHostCall({ outcome: "failure", function: "not-a-capability" });
				const snapshot = yield* findSnapshot("ryot.sandbox.host_calls", {
					outcome: "failure",
					function: "unknown",
				});
				expect(snapshot?.state).toMatchObject({ count: 1 });
			}),
		),
	);

	it.effect("keeps replay counters monotonic across outcomes", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				const before = getSandboxReplayCounters();
				yield* recordSandboxWorkflowReplayStarted;
				yield* recordSandboxWorkflowReplayFinished({
					durationMs: 12,
					kind: "workflow",
					journalEntries: 1,
					journalBytes: 512,
					outcome: "pending",
				});
				yield* recordSandboxWorkflowReplayStarted;
				yield* recordSandboxWorkflowReplayFinished({
					durationMs: 20,
					kind: "workflow",
					journalEntries: 2,
					journalBytes: 1_024,
					outcome: "completed",
				});
				const after = getSandboxReplayCounters();
				expect(after.totalStarted - before.totalStarted).toBe(2);
				expect(after.totalCompleted - before.totalCompleted).toBe(1);
				expect(after.totalFailed - before.totalFailed).toBe(0);
				expect(after.totalJournalBytes - before.totalJournalBytes).toBe(1_536);
			}),
		),
	);

	it.effect("never reports a negative number of active imports", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordProviderImportStarted;
				yield* recordProviderImportSettled;
				yield* recordProviderImportSettled;
				const snapshot = yield* findSnapshot("ryot.provider_import.active", {});
				expect(snapshot?.state).toMatchObject({ value: 0 });
			}),
		),
	);
});
