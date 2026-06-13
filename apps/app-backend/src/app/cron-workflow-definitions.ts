import type { SandboxRunError } from "@ryot/contract/errors";

import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";
import { mediaMonitoringInfrequentTask } from "#modules/media-monitoring/infrequent-task";
import { mediaTrendingInfrequentTask } from "#modules/media-trending/infrequent-task";
import {
	FrequentCronWorkflow,
	InfrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];

type CronTaskRequirements<Task> =
	Task extends CronTask<infer _Error, infer Requirements> ? Requirements : never;

type InfrequentCronTaskRequirements = CronTaskRequirements<
	typeof mediaTrendingInfrequentTask | typeof mediaMonitoringInfrequentTask
>;

const infrequentCronTasks: ReadonlyArray<
	CronTask<SandboxRunError, InfrequentCronTaskRequirements>
> = [mediaTrendingInfrequentTask, mediaMonitoringInfrequentTask];

export const FrequentCronWorkflowDefinitionsLive = FrequentCronWorkflow.toLayer((_, executionId) =>
	runTasks(frequentCronTasks, { executionId }),
);

export const InfrequentCronWorkflowDefinitionsLive = InfrequentCronWorkflow.toLayer(
	(_, executionId) => runTasks(infrequentCronTasks, { executionId }),
);
