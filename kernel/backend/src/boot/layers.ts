import { BunCrypto, BunServices } from "@effect/platform-bun";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { Layer } from "effect";

import { WorkflowEngineLive } from "#boot/workflow-engine";
import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import {
	UserLifecycleJobProvidedLive,
	UserLifecycleServiceLive,
} from "#modules/accounts/lifecycle/layer";
import { UserSettingsServiceLive } from "#modules/accounts/preferences/layer";
import {
	UserBootstrapJobProvidedLive,
	UserBootstrapSchedulingLive,
} from "#modules/accounts/provisioning/layer";
import {
	ManagedAssetCollectorLive,
	ObjectStorageServiceLive,
	UploadServicesLive,
} from "#modules/assets/layer";
import { ManagedAssetsRepository } from "#modules/assets/storage/managed-assets-repository";
import { DirectPolicyAttempts } from "#modules/automations/execution";
import {
	AutomationReconciliationLive,
	AutomationRetentionLive,
	AutomationRunOperationsServiceLive,
	LifecycleServicesLive,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
} from "#modules/automations/layer";
import {
	AutomationRunJobLive,
	DirectPolicyAttemptsInstalledLive,
} from "#modules/automations/run-job-live";
import { BackupJobsLive, BackupServicesLive } from "#modules/backups/layer";
import { CalendarSourcesServiceLive } from "#modules/calendar-sources/layer";
import { CollectionsServiceLive } from "#modules/collections/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { FoldJobsLive } from "#modules/derived-values/jobs";
import { FoldExecutorInstalledLive, Folds } from "#modules/derived-values/service";
import { EntityEditorServiceLive } from "#modules/entities/editor/layer";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import {
	DeclaredLifecycleWorkProvidedLive,
	EntitiesServiceMigrationLive,
	EntitiesServiceRuntimeLive,
	EntityGraphCollectorLive,
	PluginBootstrapEntitiesRuntimeLive,
} from "#modules/entities/layer";
import { TranslationsServiceLive } from "#modules/entities/localization/layer";
import { EntityTranslationJobLive } from "#modules/entities/localization/translation-job";
import { EntityImportJobLive } from "#modules/entities/providers/entity-import-job";
import {
	EntityEnrichmentServiceLive,
	EntityImportServiceLive,
	EntityImportWorkflowOperationsProvidedLive,
	EntityPopulationJobProvidedLive,
	EntityPopulationLive,
	ProviderEntitySearchServiceLive,
} from "#modules/entities/providers/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EntityUserDataServiceLive } from "#modules/entities/user-data/layer";
import { EventMutationsLive, EventsServiceLive } from "#modules/events/layer";
import { WorkflowGarbageCollector } from "#modules/garbage-collection/workflows";
import { ImportRunCancellationService } from "#modules/imports/cancellation-service";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { GenericImportChunks } from "#modules/imports/generic-import-workflow";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow-live";
import {
	GenericImportChunksProvidedLive,
	ImportsServiceLive,
	IngestionArtifactStagingProvidedLive,
	IngestionRetirementLive,
} from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { InstanceAdminServiceLive } from "#modules/instance-admin/layer";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import {
	IntegrationsServiceLive,
	IntegrationSyncJobProvidedLive,
} from "#modules/integrations/layer";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { LiveUpdates } from "#modules/live-updates/hub";
import { McpServiceLive } from "#modules/mcp/layer";
import {
	NotificationAdmissionsLive,
	NotificationDeliveryJobProvidedLive,
	NotificationDeliveryServiceLive,
	NotificationsServiceLive,
} from "#modules/notifications/layer";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { PageAuthoringServiceLive } from "#modules/pages/authoring/layer";
import { ClientArtifactStoreLive } from "#modules/pages/bundles/layer";
import { PagesServiceLive } from "#modules/pages/preparation/layer";
import { PluginCatalogHub, PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { IntegrationProviderCatalog } from "#modules/plugins/catalog/integration-providers";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginInstallationJobLive } from "#modules/plugins/installations/job";
import { PluginInstallationSweepDispatcherLive } from "#modules/plugins/installations/sweep";
import {
	PluginIngestionServiceLive,
	PluginInstallationMigrationLive,
	PluginInstallationRuntimeLive,
	PluginInvalidationSubscriberLive,
} from "#modules/plugins/layer";
import {
	OperationsServiceLive,
	PluginInstallationJobOperationsProvidedLive,
} from "#modules/plugins/operations/layer";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	PublicationArtifactGrantsLive,
	PublicationsServiceLive,
} from "#modules/publications/layer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { ReminderEntityLifecycleLive } from "#modules/reminders/entity-lifecycle";
import {
	ReminderNotificationSourcePolicyLive,
	RemindersServiceLive,
	ReminderWorkerLive,
} from "#modules/reminders/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { PluginCronSchedulerProvidedLive, PluginCronServiceLive } from "#modules/scheduler/layer";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import { SandboxReplayJobsLive } from "#modules/scripts/executions/queues";
import { DirectScriptExecutor } from "#modules/scripts/executions/workflow";
import { SandboxWorkflowDefinitionsLive } from "#modules/scripts/executions/workflow-live";
import { SandboxHostConfigLive } from "#modules/scripts/host/sandbox-host-live";
import { SandboxWorkflowPinningLive, ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { ExecutableArtifacts } from "#modules/scripts/registry/executable-artifacts";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { SignalScheduleWorkerLive } from "#modules/signal-schedules/layer";
import { TestSupportServicesLive } from "#modules/test-support/layer";
import { Broadcast } from "#platform/broadcast";
import { AppConfig } from "#platform/config/service";
import { MigrationsComplete } from "#platform/db/migrate";
import { PgClientLive } from "#platform/db/postgres";
import { DatabaseSession } from "#platform/db/session";
import { EgressHttpClientLive } from "#platform/egress/http-client";
import { JobQueue } from "#platform/jobs/queue";
import { JobHandlers, JobWorkerLive } from "#platform/jobs/worker";
import { ObservabilityLive } from "#platform/observability/observability";
import { ProKeyService } from "#platform/pro-key";
import { ServerRun } from "#platform/server-run";
import { DownloadTickets } from "#platform/storage/download-tickets";
import { HmacSigner } from "#platform/storage/hmac-signer";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";
import { TransientValues } from "#platform/transient-values";

import { AdmittedWorkflowCatalogueLive } from "./admitted-workflows";
import { FrequentCronJobLive } from "./frequent-cron-job";
import { ImportRunExecutionControllerLive } from "./import-run-execution-controller";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
import {
	DirectScriptDispatcherLive,
	RuntimeSandboxExecutorLive,
	SandboxDurableHostDispatcherProvidedLive,
} from "./script-host";
import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.layer, BunServices.layer, BunCrypto.layerSecureRandom);

const SignedUrlInfrastructureLive = Layer.provideMerge(
	Layer.mergeAll(LocalStorageService.layer, DownloadTickets.layer),
	HmacSigner.layer,
);

const BaseInfrastructureServicesLive = Layer.provideMerge(
	ExecutionFileStore.layer,
	Layer.provideMerge(
		SandboxHostConfigLive,
		Layer.provideMerge(
			TransientValues.layer,
			Layer.mergeAll(
				PgClientLive,
				DatabaseSession.layer,
				Broadcast.layer,
				SignedUrlInfrastructureLive,
				ServerRun.layer,
				S3Service.layer,
				ProKeyService.layer,
				EgressHttpClientLive,
			),
		),
	),
);

const CoreInfrastructureDependenciesLive = BaseInfrastructureServicesLive.pipe(
	Layer.provideMerge(ConfigLive),
);

const ApplicationInfrastructureLive = Layer.mergeAll(
	WorkflowEngineLive,
	JobQueue.layer,
	JobHandlers.layer,
	GenericImportChunks.layer,
).pipe(Layer.provideMerge(CoreInfrastructureDependenciesLive));

// Content lifecycle services cross the plugin/definition boundary during writes.
const ContentLifecycleRepositoriesLive = Layer.merge(
	PluginRepository.layer,
	DefinitionRepository.layer,
);

// One reference keeps a single sandbox runtime with ingestion staging for every consumer.
const StagedRuntimeSandboxExecutorLive = RuntimeSandboxExecutorLive.pipe(
	Layer.provide(IngestionArtifactStagingProvidedLive),
);

const SandboxWorkflowDependenciesLive = Layer.mergeAll(
	SandboxRepository.layer,
	SandboxWorkflowPinningLive,
	SandboxWorkflowReferenceRepository.layer,
	KernelWorkflowReferencesLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				EnrichmentRequests.layer,
				EntitiesRepositoryLive,
				ImportsRepository.layer,
				IngestionCaptures.layer,
				IntegrationsRepository.layer,
				PluginRuntimeResolverLive,
				SandboxRepository.layer,
				SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer)),
			),
		),
	),
);

const DirectScriptExecutorLive = DirectScriptExecutor.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			SandboxWorkflowDependenciesLive,
			ExecutableArtifacts.layer,
			DirectScriptDispatcherLive,
		),
	),
);

const AutomationRunOperationsLive = Layer.provide(
	AutomationRunOperationsServiceLive,
	Layer.merge(ScriptExecutionServiceLive, DirectScriptExecutorLive),
);

const FoldExecutorProvidedLive = FoldExecutorInstalledLive.pipe(
	Layer.provide(DirectScriptExecutorLive),
);

const ServicesLive = Layer.mergeAll(
	AuthServiceLive,
	BackupServicesLive,
	CollectionsServiceLive,
	EntitiesServiceRuntimeLive,
	EntityEditorServiceLive,
	EntityImportServiceLive,
	EntityEnrichmentServiceLive,
	EntityPopulationLive,
	EventsServiceLive,
	InstanceAdminServiceLive,
	ImportsServiceLive,
	ImportRunCancellationService.layer.pipe(
		Layer.provide(Layer.merge(ImportsRepository.layer, ImportRunExecutionControllerLive)),
	),
	IntegrationsServiceLive,
	LiveUpdates.layer,
	NotificationDeliveryServiceLive,
	NotificationAdmissionsLive,
	NotificationsServiceLive,
	OAuthConnectionsServiceLive,
	McpServiceLive,
	RemindersServiceLive,
	ReminderWorkerLive,
	OperationsServiceLive,
	PluginIngestionServiceLive,
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriberLive,
	PluginInstallationRuntimeLive,
	ProviderEntitySearchServiceLive,
	RelationshipsServiceLive,
	ScriptExecutionServiceLive,
	SavedViewsServiceLive,
	CalendarSourcesServiceLive,
	SignalScheduleWorkerLive,
	RyotQLService.layer,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	TranslationsServiceLive,
	UploadServicesLive,
	ManagedAssetCollectorLive,
	EntityGraphCollectorLive,
	UserLifecycleServiceLive,
	UserSettingsServiceLive,
	EntityUserDataServiceLive,
	UserBootstrapSchedulingLive,
	PagesServiceLive,
	PageAuthoringServiceLive,
	PublicationsServiceLive,
	PublicationArtifactGrantsLive,
	ClientArtifactStoreLive,
	AutomationReconciliationLive,
	AutomationRetentionLive,
	WorkflowGarbageCollector.layer,
	PluginCronServiceLive,
	LifecycleServicesLive,
	// HTTP routes consume these ports directly.
	LifecycleWriteGuard.layer,
	ObjectStorageServiceLive,
	PluginCatalogHub.layer,
).pipe(
	Layer.provideMerge(StagedRuntimeSandboxExecutorLive),
	Layer.provideMerge(PluginConfigEncryptionKey.layer),
	Layer.provide(Layer.merge(ContentLifecycleRepositoriesLive, AdmittedWorkflowCatalogueLive)),
	Layer.provideMerge(DeclaredLifecycleWorkProvidedLive),
);

const ServicesWithTestSupportLive = Layer.merge(
	ServicesLive,
	TestSupportServicesLive.pipe(Layer.provide(StagedRuntimeSandboxExecutorLive)),
).pipe(
	Layer.provide(PluginBootstrapEntitiesRuntimeLive),
	Layer.provideMerge(Layer.mergeAll(IngestionRetirementLive, PluginRuntimeResolverLive)),
	Layer.provide(AdmittedWorkflowCatalogueLive),
);

// Boot merges feature-owned definitions and keeps cross-feature composition explicit here.
const RuntimeWorkflowDefinitionsLive = Layer.mergeAll(
	ImportWorkflowDefinitionsLive,
	GenericImportChunksProvidedLive,
	Layer.provide(
		IntegrationWorkflowDefinitionsLive,
		Layer.mergeAll(
			IntegrationProviderCatalog.layer,
			ImportsRepository.layer,
			IntegrationsRepository.layer,
		),
	),
	Layer.provide(SandboxWorkflowDefinitionsLive, SandboxWorkflowDependenciesLive),
).pipe(Layer.provide(AdmittedWorkflowCatalogueLive));

const RuntimeSchedulersLive = Layer.mergeAll(
	FrequentCronSchedulerLive,
	PluginInstallationSweepDispatcherLive,
	PluginCronSchedulerProvidedLive,
);

// Handlers register before the worker starts claiming.
const RuntimeJobsLive = JobWorkerLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			FrequentCronJobLive.pipe(Layer.provide(EnrichmentRequests.layer)),
			NotificationDeliveryJobProvidedLive,
			UserLifecycleJobProvidedLive.pipe(Layer.provide(PluginBootstrapEntitiesRuntimeLive)),
			BackupJobsLive,
			IntegrationSyncJobProvidedLive,
			UserBootstrapJobProvidedLive.pipe(Layer.provide(PluginBootstrapEntitiesRuntimeLive)),
			PluginInstallationJobLive,
			FoldJobsLive.pipe(Layer.provide(Layer.merge(EventMutationsLive, Folds.layer))),
			AutomationRunJobLive,
			SandboxReplayJobsLive.pipe(
				Layer.provide(Layer.merge(ExecutableArtifacts.layer, SandboxWorkflowDependenciesLive)),
			),
			EntityPopulationJobProvidedLive,
			EntityImportJobLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						EnrichmentRequests.layer,
						EntitiesRepositoryLive,
						ScriptExecutionServiceLive,
					),
				),
			),
			EntityTranslationJobLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						EnrichmentRequests.layer,
						TranslationsServiceLive,
						ScriptExecutionServiceLive,
					),
				),
			),
		),
	),
);

const RuntimeWorkLive = Layer.merge(RuntimeWorkflowDefinitionsLive, RuntimeJobsLive);

const RuntimeLive = Layer.mergeAll(
	RuntimeWorkLive,
	ServerLive,
	RuntimeSchedulersLive,
	DirectPolicyAttemptsInstalledLive,
	FoldExecutorProvidedLive,
);

const MigrationBootstrapServicesLive = Layer.mergeAll(
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
	EntitiesServiceMigrationLive,
).pipe(Layer.provide(ContentLifecycleRepositoriesLive));

export const SchemaMigrationLive = MigrationsComplete.layer;

export const MigrationDatabaseLive = Layer.merge(PgClientLive, DatabaseSession.layer).pipe(
	Layer.provideMerge(ConfigLive),
);

export const MigrationInfrastructureLive = Layer.mergeAll(
	MigrationBootstrapServicesLive,
	PluginInstallationMigrationLive,
	IntegrationsRepository.layer,
).pipe(
	Layer.provideMerge(DeclaredLifecycleWorkProvidedLive),
	Layer.provideMerge(DirectPolicyAttempts.layer),
	Layer.provideMerge(ReminderEntityLifecycleLive),
	Layer.provideMerge(AdmittedWorkflowCatalogueLive),
	Layer.provideMerge(WorkflowEngineLive),
	Layer.provideMerge(PgClientLive),
	// Legacy migration and system ingestion consume these repositories directly.
	Layer.provideMerge(
		Layer.mergeAll(ContentLifecycleRepositoriesLive, ManagedAssetsRepository.layer),
	),
	Layer.provideMerge(TransientValues.layer),
	Layer.provideMerge(Broadcast.layer),
	Layer.provideMerge(SignedUrlInfrastructureLive),
	Layer.provideMerge(S3Service.layer),
	Layer.provideMerge(PluginConfigEncryptionKey.layer),
	Layer.provideMerge(DatabaseSession.layer),
	Layer.provideMerge(ConfigLive),
);

// Workflow operations cross feature boundaries; boot composes their owning Layers.
const RuntimeWorkflowOperationsLive = Layer.mergeAll(
	SandboxDurableHostDispatcherProvidedLive,
	AutomationRunOperationsLive,
	EntityImportWorkflowOperationsProvidedLive,
	PluginInstallationJobOperationsProvidedLive,
).pipe(Layer.provide(PluginBootstrapEntitiesRuntimeLive));

export const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.provideMerge(
		Layer.provideMerge(RuntimeWorkflowOperationsLive, ServicesWithTestSupportLive),
		Layer.merge(ReminderNotificationSourcePolicyLive, ReminderEntityLifecycleLive),
	),
	ApplicationInfrastructureLive,
);

export const RuntimeServerLive = RuntimeLive.pipe(Layer.provide(RuntimeDependenciesLive));

export const ObservabilityProvidedLive = ObservabilityLive.pipe(Layer.provide(ConfigLive));
