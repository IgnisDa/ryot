import { describe, expect, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import {
	recordSandboxExecution,
	recordSandboxExecutionUsage,
	recordSandboxHostCall,
	sandboxMetricHostFunction,
	sandboxMetricKind,
} from "./metrics";

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
		expect(sandboxMetricHostFunction("replayJournal")).toBe("unknown");
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
});
