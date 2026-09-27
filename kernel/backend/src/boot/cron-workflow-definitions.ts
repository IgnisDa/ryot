import { DateTime, Effect } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { DatabaseSession } from "#lib/infrastructure/db/session";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import type { AutomationReconciliation } from "#modules/automations/reconciliation";
import { automationsFrequentTask } from "#modules/automations/reconciliation";
import { AutomationRetention } from "#modules/automations/retention";
import { BackupsService } from "#modules/backups/service";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { WorkflowGarbageCollector } from "#modules/garbage-collection/workflows";
import { ingestionFrequentTask } from "#modules/imports/frequent-task";
import type { ImportsService } from "#modules/imports/service";
import { integrationsFrequentTask } from "#modules/integrations/frequent-task";
import { oauthConnectionsFrequentTask } from "#modules/oauth-connections/frequent-task";
import type { OAuthConnectionsService } from "#modules/oauth-connections/service";
import type { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { pluginCatalogFrequentTask } from "#modules/plugins/frequent-task";
import type { PluginInstallationService } from "#modules/plugins/installation-service";
import { pluginInstallationFrequentTask } from "#modules/plugins/installation-sweep";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";
import { uploadsFrequentTask } from "#modules/uploads/frequent-task";
import type { UploadIntentsService } from "#modules/uploads/intents/service";
import { userBootstrapFrequentTask } from "#modules/user-bootstrap/frequent-task";
import type { UserBootstrapScheduling } from "#modules/user-bootstrap/scheduling";
import { userLifecycleFrequentTask } from "#modules/user-lifecycle/frequent-task";
import type { UserLifecycleService } from "#modules/user-lifecycle/service";

const frequentCronTasks: ReadonlyArray<
	CronTask<
		never,
		| AutomationReconciliation
		| AutomationRetention
		| BackupsService
		| DatabaseSession
		| EventStreamWorkService
		| OAuthConnectionsService
		| UploadIntentsService
		| PluginCatalogInvalidator
		| PluginInstallationService
		| UserBootstrapScheduling
		| UserLifecycleService
		| WorkflowEngine
		| ImportsService
		| WorkflowGarbageCollector
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
	{
		name: "workflow-garbage-collection",
		run: () =>
			Effect.gen(function* () {
				const garbageCollector = yield* WorkflowGarbageCollector;
				yield* garbageCollector.runBatch();
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("workflow garbage collection batch failed", cause),
				),
			),
	},
	automationsFrequentTask,
	{
		name: "event-stream-work-reconcile",
		run: () =>
			Effect.flatMap(EventStreamWorkService, (service) => service.reconcile()).pipe(
				Effect.catchCause(() =>
					Effect.logWarning("event stream work reconciliation listing failed"),
				),
			),
	},
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
	ingestionFrequentTask,
	oauthConnectionsFrequentTask,
	uploadsFrequentTask,
	userBootstrapFrequentTask,
	userLifecycleFrequentTask,
	pluginCatalogFrequentTask,
	pluginInstallationFrequentTask,
];

const runFrequentCronWorkflow = Effect.fn("FrequentCronWorkflow")(
	function* (_payload: CronRunPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		yield* runTasks(frequentCronTasks, { executionId });
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "FrequentCronWorkflow" }),
);

export const FrequentCronWorkflowDefinitionsLive = implementWorkflow(
	FrequentCronWorkflow,
	runFrequentCronWorkflow,
);
