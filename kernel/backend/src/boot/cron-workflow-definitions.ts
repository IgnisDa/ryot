import { DateTime, Effect } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { userLifecycleFrequentTask } from "#modules/accounts/lifecycle/frequent-task";
import type { UserLifecycleService } from "#modules/accounts/lifecycle/service";
import { userBootstrapFrequentTask } from "#modules/accounts/provisioning/frequent-task";
import type { UserBootstrapScheduling } from "#modules/accounts/provisioning/scheduling";
import { managedAssetsFrequentTask, uploadsFrequentTask } from "#modules/assets/frequent-task";
import type { ManagedAssetCollector } from "#modules/assets/storage/managed-asset-collector";
import type { UploadIntentsService } from "#modules/assets/uploads/intents";
import type { AutomationReconciliation } from "#modules/automations/reconciliation";
import { automationsFrequentTask } from "#modules/automations/reconciliation";
import { AutomationRetention } from "#modules/automations/retention";
import { BackgroundWorkService } from "#modules/background-work/service";
import { BackupsService } from "#modules/backups/service";
import type { EntityGraphCollector } from "#modules/entities/retention/collector";
import { entityGraphFrequentTask } from "#modules/entities/retention/frequent-task";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { WorkflowGarbageCollector } from "#modules/garbage-collection/workflows";
import { ingestionFrequentTask } from "#modules/imports/frequent-task";
import type { ImportsService } from "#modules/imports/service";
import { integrationsFrequentTask } from "#modules/integrations/frequent-task";
import { MutationReceipts } from "#modules/mutations/receipts";
import { oauthConnectionsFrequentTask } from "#modules/oauth-connections/frequent-task";
import type { OAuthConnectionsService } from "#modules/oauth-connections/service";
import type { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import { pluginCatalogFrequentTask } from "#modules/plugins/catalog/frequent-task";
import type { PluginInstallationService } from "#modules/plugins/installations/service";
import { pluginInstallationFrequentTask } from "#modules/plugins/installations/sweep";
import {
	type CronRunPayload,
	FrequentCronWorkflow,
	runTasks,
} from "#modules/scheduler/cron-workflow";
import type { CronTask } from "#modules/scheduler/types";
import type { DatabaseSession } from "#platform/db/session";
import { implementWorkflow } from "#platform/workflow/scope";

const frequentCronTasks: ReadonlyArray<
	CronTask<
		never,
		| BackupsService
		| WorkflowEngine
		| ImportsService
		| DatabaseSession
		| MutationReceipts
		| AutomationRetention
		| UploadIntentsService
		| UserLifecycleService
		| EntityGraphCollector
		| ManagedAssetCollector
		| BackgroundWorkService
		| EventStreamWorkService
		| OAuthConnectionsService
		| UserBootstrapScheduling
		| AutomationReconciliation
		| PluginCatalogInvalidator
		| WorkflowGarbageCollector
		| PluginInstallationService
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
		name: "background-work-recovery",
		run: () =>
			Effect.flatMap(BackgroundWorkService, (service) => service.recover()).pipe(
				Effect.catchCause((cause) => Effect.logWarning("Background work recovery failed", cause)),
			),
	},
	{
		name: "background-work-retention",
		run: () =>
			Effect.flatMap(BackgroundWorkService, (service) => service.pruneSettled(500)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("background work retention failed", cause)),
			),
	},
	{
		name: "mutation-receipt-retention",
		run: () =>
			Effect.flatMap(MutationReceipts, (receipts) => receipts.pruneRetired(500)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("mutation receipt retention failed", cause)),
			),
	},
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
	managedAssetsFrequentTask,
	entityGraphFrequentTask,
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
