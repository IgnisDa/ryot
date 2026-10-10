import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { RunnerAddress } from "effect/cluster";
import { Workflow } from "effect/workflow";

import { shardingConfigFor } from "#lib/infrastructure/workflow";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { workflowEngineTestLayer } from "#lib/test-utils/effect";

const ChildWorkflow = Workflow.make("DiscardedChildTestWorkflow", {
	error: Schema.Never,
	success: Schema.Void,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const ChildWorkflowLayer = implementWorkflow(ChildWorkflow, () => Effect.void).pipe(
	Layer.provideMerge(workflowEngineTestLayer),
);

layer(ChildWorkflowLayer)((test) => {
	test.effect("provides an in-memory workflow test runtime", () =>
		ChildWorkflow.execute({ executionId: "memory" }),
	);
});

describe("sharding config per role", () => {
	it("assigns the default group to background work and the interactive group to interactive work", () => {
		expect(shardingConfigFor("all")).toEqual({
			shardLockDisableAdvisory: true,
			assignedShardGroups: ["default", "interactive"],
			availableShardGroups: ["default", "interactive"],
		});
		expect(shardingConfigFor("interactive")).toEqual({
			shardLockDisableAdvisory: true,
			assignedShardGroups: ["interactive"],
			availableShardGroups: ["default", "interactive"],
			runnerAddress: Option.some(RunnerAddress.make("interactive", 0)),
		});
		expect(shardingConfigFor("background")).toEqual({
			shardLockDisableAdvisory: true,
			assignedShardGroups: ["default"],
			availableShardGroups: ["default", "interactive"],
			runnerAddress: Option.some(RunnerAddress.make("background", 0)),
		});
	});
});
