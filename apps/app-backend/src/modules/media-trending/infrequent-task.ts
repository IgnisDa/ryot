import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { Effect } from "effect";

import type { InfrequentCronTask } from "#modules/scheduler/types";

import { RefreshMediaTrendingWorkflow } from "./refresh-workflow";

export const mediaTrendingInfrequentTask: InfrequentCronTask = {
	name: "media-trending-refresh",
	run: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const executionId = `media-trending-${generateId()}`;
		yield* engine
			.execute(RefreshMediaTrendingWorkflow, {
				executionId,
				discard: true,
				payload: { executionId },
			})
			.pipe(Effect.orDie);
	}),
};
