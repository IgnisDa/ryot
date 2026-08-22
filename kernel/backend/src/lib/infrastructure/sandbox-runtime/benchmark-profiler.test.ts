import { describe, expect, it } from "vitest";

import { makeSandboxProfileRegistry } from "./benchmark-profiler";

const arm = {
	executions: 1,
	cpuProfile: true,
	token: "ytm-details",
	maxAttemptsPerExecution: 2,
	maxHeapSnapshotsPerAttempt: 3,
	scriptSlug: "music.youtube-music.details",
};

describe("sandbox profile registry", () => {
	it("binds the first matching execution and profiles each of its replay attempts", () => {
		const registry = makeSandboxProfileRegistry("/profiles");
		registry.arm(arm);

		expect(registry.select({ scriptSlug: "other.script", executionKey: "workflow-0" })).toBeNull();
		const first = registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });
		const unrelated = registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-2" });
		const replay = registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });

		expect(first?.directory).toBe("/profiles/ytm-details/execution-1/attempt-1");
		expect(first?.maxHeapSnapshots).toBe(3);
		expect(unrelated).toBeNull();
		expect(replay?.directory).toBe("/profiles/ytm-details/execution-1/attempt-2");
	});

	it("stops profiling an execution once its attempt budget is spent", () => {
		const registry = makeSandboxProfileRegistry("/profiles");
		registry.arm(arm);

		registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });
		registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });

		expect(registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" })).toBeNull();
		expect(registry.status(arm.token).executions[0]?.attempts).toHaveLength(2);
	});

	it("selects distinct executions up to the armed count and reports status by token", () => {
		const registry = makeSandboxProfileRegistry("/profiles");
		registry.arm({ ...arm, executions: 2 });

		registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });
		expect(registry.status(arm.token)).toMatchObject({ armed: true, remainingExecutions: 1 });
		const second = registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-2" });

		expect(second?.directory).toBe("/profiles/ytm-details/execution-2/attempt-1");
		expect(registry.status(arm.token)).toMatchObject({ armed: false, remainingExecutions: 0 });
		expect(registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-3" })).toBeNull();
	});

	it("drops pending selections on disarm without forgetting bound executions", () => {
		const registry = makeSandboxProfileRegistry("/profiles");
		registry.arm({ ...arm, executions: 2 });
		registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-1" });

		expect(registry.disarm()).toBe(1);
		expect(registry.select({ scriptSlug: arm.scriptSlug, executionKey: "workflow-2" })).toBeNull();
		expect(registry.status(arm.token).executions).toHaveLength(1);
	});
});
