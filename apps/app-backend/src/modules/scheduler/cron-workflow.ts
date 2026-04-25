import { Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

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
	error: withoutSchemaServices(Schema.Never),
	success: withoutSchemaServices(Schema.Void),
	payload: withoutSchemaServices(CronRunPayload),
	idempotencyKey: ({ executionId }) => executionId,
});
