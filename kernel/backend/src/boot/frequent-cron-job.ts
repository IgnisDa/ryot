import { DateTime, Effect } from "effect";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { userBootstrapFrequentTask } from "#modules/accounts/provisioning/frequent-task";
import type { UserBootstrapScheduling } from "#modules/accounts/provisioning/scheduling";
import { managedAssetsFrequentTask, uploadsFrequentTask } from "#modules/assets/frequent-task";
import type { ManagedAssetCollector } from "#modules/assets/storage/managed-asset-collector";
import type { UploadIntentsService } from "#modules/assets/uploads/intents";
import type { AutomationReconciliation } from "#modules/automations/reconciliation";
import { automationsFrequentTask } from "#modules/automations/reconciliation";
import { AutomationRetention } from "#modules/automations/retention";
import { BackupsService } from "#modules/backups/service";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import type { EntityGraphCollector } from "#modules/entities/retention/collector";
import { entityGraphFrequentTask } from "#modules/entities/retention/frequent-task";
import { WorkflowGarbageCollector } from "#modules/garbage-collection/workflows";
import { ingestionFrequentTask } from "#modules/imports/frequent-task";
import type { ImportsService } from "#modules/imports/service";
import { integrationsFrequentTask } from "#modules/integrations/frequent-task";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { NotificationAdmissions } from "#modules/notifications/admission";
import { oauthConnectionsFrequentTask } from "#modules/oauth-connections/frequent-task";
import type { OAuthConnectionsService } from "#modules/oauth-connections/service";
import type { PluginCatalogInvalidator } from "#modules/plugins/catalog/events";
import type { PluginInstallationService } from "#modules/plugins/installations/service";
import { pluginInstallationFrequentTask } from "#modules/plugins/installations/sweep";
import { ReminderWorker } from "#modules/reminders/worker";
import { runTasks } from "#modules/scheduler/cron-tasks";
import { FrequentCronJob, scheduleFrequentCron } from "#modules/scheduler/frequent-cron";
import type { CronTask } from "#modules/scheduler/types";
import { pruneSandboxJournals } from "#modules/scripts/replay/journal-store";
import { SignalScheduleWorker } from "#modules/signal-schedules/worker";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { registerJobHandler } from "#platform/jobs/worker";
import { TransientValues } from "#platform/transient-values";

const frequentCronTasks: ReadonlyArray<
	CronTask<
		never,
		| JobQueue
		| BackupsService
		| WorkflowEngine
		| ImportsService
		| ReminderWorker
		| TransientValues
		| DatabaseSession
		| EnrichmentRequests
		| AutomationRetention
		| UploadIntentsService
		| EntityGraphCollector
		| SignalScheduleWorker
		| ManagedAssetCollector
		| NotificationAdmissions
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
		name: "transient-value-retention",
		run: () =>
			Effect.flatMap(TransientValues, (values) => values.prune(1_000)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("transient value retention failed", cause)),
			),
	},
	{
		name: "sandbox-journal-retention",
		run: () =>
			Effect.flatMap(DatabaseSession, (session) => pruneSandboxJournals(session, 1_000)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("sandbox journal retention failed", cause)),
			),
	},
	{
		name: "enrichment-request-settlement",
		run: () =>
			Effect.flatMap(EnrichmentRequests, (requests) =>
				requests.failOrphaned(100).pipe(Effect.andThen(requests.prune())),
			).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("enrichment request settlement failed", cause),
				),
			),
	},
	{
		name: "failed-job-retention",
		run: () =>
			Effect.flatMap(JobQueue, (queue) => queue.pruneFailed(500)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("failed job retention failed", cause)),
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
		name: "entity-reminders",
		run: () =>
			Effect.flatMap(ReminderWorker, (worker) => worker.run()).pipe(
				Effect.catchCause((cause) => Effect.logWarning("Reminder scan failed", cause)),
			),
	},
	{
		name: "signal-schedules",
		run: () =>
			Effect.flatMap(SignalScheduleWorker, (worker) => worker.run()).pipe(
				Effect.catchCause((cause) => Effect.logWarning("Signal schedule scan failed", cause)),
			),
	},
	{
		name: "notification-diagnostics-retention",
		run: () =>
			Effect.flatMap(NotificationAdmissions, (admissions) => admissions.pruneDiagnostics()).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("Notification diagnostics retention failed", cause),
				),
			),
	},
	{
		name: "idempotency-key-retention",
		run: () =>
			Effect.flatMap(IdempotencyKeys.make, (keys) => keys.pruneExpired(500)).pipe(
				Effect.catchCause((cause) => Effect.logWarning("idempotency key retention failed", cause)),
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
	pluginInstallationFrequentTask,
];

// Each run queues the next occurrence before its tasks, so a failed task never stops the schedule.
export const FrequentCronJobLive = registerJobHandler(FrequentCronJob, (_payload, job) =>
	scheduleFrequentCron.pipe(
		Effect.andThen(runTasks(frequentCronTasks, { executionId: job.id })),
		Effect.annotateLogs({ jobId: job.id, job: FrequentCronJob.name }),
	),
);
