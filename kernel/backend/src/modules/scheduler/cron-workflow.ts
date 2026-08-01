import { Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

import type { CronTask, CronTaskContext } from "./types";

export const runTasks = <E, R>(tasks: ReadonlyArray<CronTask<E, R>>, ctx: CronTaskContext) =>
	Effect.forEach(
		tasks,
		(task) =>
			task
				.run(ctx)
				.pipe(
					Effect.catchCause((cause) =>
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

export const FrequentCronWorkflow = Workflow.make("FrequentCronWorkflow", {
	error: Schema.Never satisfies DurableSchema,
	success: Schema.Void satisfies DurableSchema,
	payload: CronRunPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});
