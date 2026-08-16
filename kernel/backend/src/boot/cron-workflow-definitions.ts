import { DateTime, Effect } from "effect";
import type { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { Database } from "#lib/infrastructure/db/service";
import type { AutomationReconciliation } from "#modules/automations/reconciliation";
import { automationsFrequentTask } from "#modules/automations/reconciliation";
import { AutomationRetention } from "#modules/automations/retention";
import { BackupsService } from "#modules/backups/service";
import { integrationsFrequentTask } from "#modules/integrations/frequent-task";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";
import { uploadsFrequentTask } from "#modules/uploads/frequent-task";
import type { UploadIntentsService } from "#modules/uploads/intents/service";
import { userLifecycleFrequentTask } from "#modules/user-lifecycle/frequent-task";
import type { UserLifecycleService } from "#modules/user-lifecycle/service";

const frequentCronTasks: ReadonlyArray<
	CronTask<
		never,
		| AutomationReconciliation
		| AutomationRetention
		| BackupsService
		| Database
		| UploadIntentsService
		| UserLifecycleService
		| WorkflowEngine
	>
> = [
	{
		name: "backups-cleanup",
		run: () =>
			Effect.gen(function* () {
				const service = yield* BackupsService;
				yield* service.cleanupExpiredArtifacts(100);
			}).pipe(
				Effect.catchCause((cause) => Effect.logWarning("backup cleanup listing failed", cause)),
			),
	},
	automationsFrequentTask,
	{
		name: "automations-retention",
		run: () =>
			Effect.gen(function* () {
				const retention = yield* AutomationRetention;
				yield* retention.runBatch(DateTime.toDate(yield* DateTime.now), 100);
			}).pipe(
				Effect.catchCause((cause) => Effect.logWarning("automation retention batch failed", cause)),
			),
	},
	integrationsFrequentTask,
	uploadsFrequentTask,
	userLifecycleFrequentTask,
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
