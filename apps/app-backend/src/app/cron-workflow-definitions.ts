import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";
import {
	type InfrequentCronTask,
	mediaTrendingInfrequentTask,
} from "#modules/media-trending/infrequent-task";
import {
	FrequentCronWorkflow,
	InfrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];
const infrequentCronTasks: ReadonlyArray<InfrequentCronTask> = [mediaTrendingInfrequentTask];

export const FrequentCronWorkflowDefinitionsLive = FrequentCronWorkflow.toLayer((_, executionId) =>
	runTasks(frequentCronTasks, { executionId }),
);

export const InfrequentCronWorkflowDefinitionsLive = InfrequentCronWorkflow.toLayer(
	(_, executionId) => runTasks(infrequentCronTasks, { executionId }),
);
