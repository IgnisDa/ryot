import { describe, expect, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import {
	recordHttpAdmissionTicket,
	recordProviderImportBodySettled,
	recordProviderImportBodyStarted,
	recordSandboxExecution,
	recordSandboxExecutionUsage,
	recordSandboxHostCall,
	recordSandboxWorkflowReplayFinished,
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

	it.effect("records CPU slot wait against the lane of the execution", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				const usage = {
					tier: "core",
					heapBytes: 1,
					trust: "system",
					kind: "provider",
					externalBytes: 1,
					outcome: "completed",
				} as const;
				yield* recordSandboxExecutionUsage({ ...usage, cpuWaitMs: 900, lane: "background" });
				yield* recordSandboxExecutionUsage({ ...usage, cpuWaitMs: 4, lane: "interactive" });
				const background = yield* findSnapshot("ryot.sandbox.execution.cpu_wait", {
					lane: "background",
				});
				const interactive = yield* findSnapshot("ryot.sandbox.execution.cpu_wait", {
					lane: "interactive",
				});
				expect(background?.state).toMatchObject({ count: 1, sum: 900 });
				expect(interactive?.state).toMatchObject({ sum: 4, count: 1 });
			}),
		),
	);

	it.effect("records HTTP admission tickets by lane, policy and outcome only", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordHttpAdmissionTicket({
					waitedMs: 250,
					outcome: "granted",
					lane: "interactive",
					policy: "musicbrainz",
				});
				yield* recordHttpAdmissionTicket({
					lane: "background",
					outcome: "overloaded",
					policy: "musicbrainz",
				});
				const granted = yield* findSnapshot("ryot.http_admission.tickets", {
					outcome: "granted",
					lane: "interactive",
					policy: "musicbrainz",
				});
				const wait = yield* findSnapshot("ryot.http_admission.ticket_wait", {
					lane: "interactive",
					policy: "musicbrainz",
				});
				const overloaded = yield* findSnapshot("ryot.http_admission.tickets", {
					lane: "background",
					outcome: "overloaded",
				});
				expect(granted?.state).toMatchObject({ count: 1 });
				expect(wait?.state).toMatchObject({ count: 1, sum: 250 });
				expect(overloaded?.state).toMatchObject({ count: 1 });
				expect(Object.keys(granted?.attributes ?? {}).sort()).toEqual([
					"lane",
					"outcome",
					"policy",
					"unit",
				]);
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

	it.effect("records a replay outcome and journal size", () =>
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
	);

	it.effect("never reports a negative number of executing import bodies", () =>
		withIsolatedRegistry(
			Effect.gen(function* () {
				yield* recordProviderImportBodyStarted;
				yield* recordProviderImportBodySettled;
				yield* recordProviderImportBodySettled;
				const snapshot = yield* findSnapshot("ryot.provider_import.executing_bodies", {});
				expect(snapshot?.state).toMatchObject({ value: 0 });
			}),
		),
	);
});
