import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { ClusterSchema, EntityId } from "effect/cluster";

import { workflowEngineTestLayer } from "#lib/test-utils/effect";

import { implementLaneWorkflow, laneWorkflow } from "./workflow-lane";

const LaneTestWorkflow = laneWorkflow("LaneTestWorkflow", {
	success: Schema.String,
	payload: { executionId: Schema.String },
	idempotencyKey: ({ executionId }) => executionId,
});

const shardGroupOf = (workflow: { readonly annotations: Context.Context<never> }) =>
	Context.get(workflow.annotations, ClusterSchema.ShardGroup)(EntityId.make("execution"));

layer(
	implementLaneWorkflow(LaneTestWorkflow, ({ executionId }) => Effect.succeed(executionId)).pipe(
		Layer.provideMerge(workflowEngineTestLayer),
	),
)((test) => {
	test.effect("pins the interactive variant to its own tag and shard group", () =>
		Effect.gen(function* () {
			const { background, interactive } = LaneTestWorkflow;

			expect([background._tag, shardGroupOf(background)]).toEqual(["LaneTestWorkflow", "default"]);
			expect([interactive._tag, shardGroupOf(interactive)]).toEqual([
				"LaneTestWorkflowInteractive",
				"interactive",
			]);
			expect(LaneTestWorkflow.forLane("interactive")).toBe(interactive);
			expect(LaneTestWorkflow.forLane("background")).toBe(background);
			expect(yield* interactive.execute({ executionId: "interactive-run" })).toBe(
				"interactive-run",
			);
			expect(yield* background.execute({ executionId: "background-run" })).toBe("background-run");
		}),
	);
});
