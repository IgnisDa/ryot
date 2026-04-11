import { Effect } from "effect";

import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];

const runFrequentCronWorkflow = Effect.fn("FrequentCronWorkflow")(
	function* (_payload: CronRunPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		yield* runTasks(frequentCronTasks, { executionId });
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "FrequentCronWorkflow" }),
);

export const FrequentCronWorkflowDefinitionsLive =
	FrequentCronWorkflow.toLayer(runFrequentCronWorkflow);
