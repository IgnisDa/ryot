import { Workflow } from "@effect/workflow";
import { Effect, Schema } from "effect";

import type { CronTask, CronTaskContext } from "./types";

export const runTasks = <E, R>(tasks: ReadonlyArray<CronTask<E, R>>, ctx: CronTaskContext) =>
	Effect.forEach(
		tasks,
		(task) =>
			task
				.run(ctx)
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError("cron task failed", cause).pipe(
							Effect.annotateLogs({ task: task.name }),
						),
					),
				),
		{ discard: true },
	);

export const CronRunPayload = Schema.Struct({
	executionId: Schema.String,
});

export type CronRunPayload = typeof CronRunPayload.Type;

export const FrequentCronWorkflow = Workflow.make({
	error: Schema.Never,
	success: Schema.Void,
	payload: CronRunPayload,
	name: "FrequentCronWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});
