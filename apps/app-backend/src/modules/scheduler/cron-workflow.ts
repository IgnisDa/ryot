import { Workflow } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";
import {
	type InfrequentCronTask,
	mediaTrendingInfrequentTask,
} from "#modules/media-trending/infrequent-task";

import type { CronTask, CronTaskContext } from "./types";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];
const infrequentCronTasks: ReadonlyArray<InfrequentCronTask> = [mediaTrendingInfrequentTask];

const runTasks = <E, R>(tasks: ReadonlyArray<CronTask<E, R>>, ctx: CronTaskContext) =>
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

export const FrequentCronWorkflowDefinitionsLive = FrequentCronWorkflow.toLayer((_, executionId) =>
	runTasks(frequentCronTasks, { executionId }),
);

export const InfrequentCronWorkflowDefinitionsLive = InfrequentCronWorkflow.toLayer(
	(_, executionId) => runTasks(infrequentCronTasks, { executionId }),
);
