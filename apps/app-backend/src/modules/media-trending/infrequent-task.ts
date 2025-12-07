import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { MediaTrendingRefreshWorkflow } from "./refresh-workflow";

type InfrequentCronTask = CronTask<never, WorkflowEngine>;

export const mediaTrendingInfrequentTask: InfrequentCronTask = {
	name: "media-trending-refresh",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const trendingExecutionId = `${executionId}-media-trending`;
			yield* engine
				.execute(MediaTrendingRefreshWorkflow, {
					discard: true,
					executionId: trendingExecutionId,
					payload: { executionId: trendingExecutionId },
				})
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError("media trending refresh enqueue failed", cause),
					),
				);
		}),
};
