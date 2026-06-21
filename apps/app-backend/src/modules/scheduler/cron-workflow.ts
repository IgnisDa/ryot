import { Workflow } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import type { CronTask, CronTaskContext } from "./types";

export const runTasks = <E, R>(tasks: ReadonlyArray<CronTask<E, R>>, ctx: CronTaskContext) =>
	Effect.forEach(
		tasks,
		(task) =>
			task
				.run(ctx)
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError(
							`Cron task '${task.name}' failed: ${unknownToMessage(Cause.squash(cause))}`,
						),
					),
				),
		{ discard: true },
	);

const CronRunPayload = Schema.Struct({
	executionId: Schema.String,
});

export const FrequentCronWorkflow = Workflow.make({
	error: Schema.Never,
	success: Schema.Void,
	payload: CronRunPayload,
	name: "FrequentCronWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

export const InfrequentCronWorkflow = Workflow.make({
	error: Schema.Never,
	success: Schema.Void,
	payload: CronRunPayload,
	name: "InfrequentCronWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});
