import { Effect } from "effect";
import type { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { integrationsFrequentTask } from "#modules/integrations/frequent-task";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";
import { uploadsFrequentTask } from "#modules/uploads/frequent-task";
import type { UploadsService } from "#modules/uploads/service";

const frequentCronTasks: ReadonlyArray<CronTask<never, WorkflowEngine | UploadsService>> = [
	integrationsFrequentTask,
	uploadsFrequentTask,
];

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
