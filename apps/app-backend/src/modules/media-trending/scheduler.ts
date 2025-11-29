import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { Cause, Duration, Effect, Layer, Schedule } from "effect";

import { RefreshMediaTrendingWorkflow } from "./refresh-workflow";

export const MediaTrendingSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;

		const refresh = Effect.gen(function* () {
			const executionId = `media-trending-${generateId()}`;
			yield* engine
				.execute(RefreshMediaTrendingWorkflow, {
					executionId,
					discard: true,
					payload: { executionId },
				})
				.pipe(Effect.orDie);
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError(`Media trending refresh failed: ${unknownToMessage(Cause.squash(cause))}`),
			),
		);

		yield* refresh.pipe(Effect.repeat(Schedule.spaced(Duration.days(1))), Effect.forkScoped);
	}),
);
