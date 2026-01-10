import type { SandboxRunError } from "@ryot/contract/errors";
import { Effect } from "effect";

import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";
import { mediaMonitoringInfrequentTask } from "#modules/media-monitoring/infrequent-task";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	InfrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];

type CronTaskRequirements<Task> =
	Task extends CronTask<infer _Error, infer Requirements> ? Requirements : never;

type InfrequentCronTaskRequirements = CronTaskRequirements<typeof mediaMonitoringInfrequentTask>;

const infrequentCronTasks: ReadonlyArray<
	CronTask<SandboxRunError, InfrequentCronTaskRequirements>
> = [mediaMonitoringInfrequentTask];

const runFrequentCronWorkflow = Effect.fn("FrequentCronWorkflow")(
	function* (_payload: CronRunPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		yield* runTasks(frequentCronTasks, { executionId });
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "FrequentCronWorkflow" }),
);

const runInfrequentCronWorkflow = Effect.fn("InfrequentCronWorkflow")(
	function* (_payload: CronRunPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		yield* runTasks(infrequentCronTasks, { executionId });
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "InfrequentCronWorkflow" }),
);

export const FrequentCronWorkflowDefinitionsLive =
	FrequentCronWorkflow.toLayer(runFrequentCronWorkflow);

export const InfrequentCronWorkflowDefinitionsLive =
	InfrequentCronWorkflow.toLayer(runInfrequentCronWorkflow);
