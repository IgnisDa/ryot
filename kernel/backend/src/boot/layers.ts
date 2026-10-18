import { BunServices } from "@effect/platform-bun";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { Layer } from "effect";
import { PersistedQueue } from "effect/persistence";

import { WorkflowEngineLive } from "#boot/workflow-engine";
import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import {
	UserLifecycleServiceLive,
	UserLifecycleWorkflowOperationsProvidedLive,
} from "#modules/accounts/lifecycle/layer";
import { UserLifecycleWorkflowDefinitionsLive } from "#modules/accounts/lifecycle/workflow";
import { UserSettingsServiceLive } from "#modules/accounts/preferences/layer";
import {
	UserBootstrapLive,
	UserBootstrapSchedulingLive,
} from "#modules/accounts/provisioning/layer";
import {
	UserBootstrapWorkflowDefinitionsLive,
	UserBootstrapWorkflowOperationsLive,
} from "#modules/accounts/provisioning/workflow";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/assets/layer";
import { ManagedAssetsRepository } from "#modules/assets/storage/managed-assets-repository";
import {
	AutomationHistoryServiceLive,
	AutomationReconciliationLive,
	AutomationRetentionLive,
	AutomationRunWorkflowOperationsServiceLive,
	LifecycleServicesLive,
	NotificationSubscriptionsServiceLive,
	PolicyBatchWorkflowProvidedLive,
	SignalEmissionServiceLive,
} from "#modules/automations/layer";
import { AutomationRunWorkflowDefinitionsLive } from "#modules/automations/run-workflow-live";
import { BackgroundWorkService } from "#modules/background-work/service";
import { BackgroundWorkWorkflowLive } from "#modules/background-work/workflow";
import { ExportBackupWorkflowDefinitionsLive } from "#modules/backups/export/workflow";
import { BackupServicesLive, BackupWorkflowOperationsLive } from "#modules/backups/layer";
import { RestoreBackupWorkflowDefinitionsLive } from "#modules/backups/restore/workflow";
import { CalendarSourcesServiceLive } from "#modules/calendar-sources/layer";
import {
	CollectionMembershipWorkflowDefinitionsLive,
	CollectionMembershipWorkflowOperationsLive,
} from "#modules/collections/collection-membership-workflow-live";
import { CollectionsServiceLive } from "#modules/collections/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntityEditorServiceLive } from "#modules/entities/editor/layer";
import { EnrichmentRecovery } from "#modules/entities/enrichment/recovery";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesServiceMigrationLive, EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import {
	TranslateEntityAttemptWorkflowDefinitionsLive,
	TranslateEntityWorkflowDefinitionsLive,
} from "#modules/entities/localization/entity-translation-workflow-live";
import { TranslationsServiceLive } from "#modules/entities/localization/layer";
import { TranslateEntityWorkflowOperationsLive } from "#modules/entities/localization/operations-workflow";
import { EntityImportWorkflowDefinitionsLive } from "#modules/entities/providers/entity-import-workflow";
import {
	EntityImportServiceLive,
	EntityImportWorkflowOperationsProvidedLive,
	EntityPopulationRetryServiceLive,
	ProviderEntityPopulationWorkflowDefinitionsProvidedLive,
	ProviderEntitySearchServiceLive,
	ProviderRelatedPagesWorkflowDefinitionsProvidedLive,
} from "#modules/entities/providers/layer";
import { EntityUserDataServiceLive } from "#modules/entities/user-data/layer";
import { InterestServicesLive } from "#modules/entities/watches/layer";
import {
	EventCreateWorkflowDefinitionsProvidedLive,
	EventsServiceLive,
	EventStreamWorkServiceLive,
} from "#modules/events/layer";
import { EventProjectionFinalizerLive } from "#modules/events/stream-work";
import { WorkflowGarbageCollector } from "#modules/garbage-collection/workflows";
import { CancelImportRunWorkflowDefinitionsLive } from "#modules/imports/cancel-workflow";
import { ImportRunCancellationService } from "#modules/imports/cancellation-service";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow-live";
import {
	DataImportWorkflowDefinitionsProvidedLive,
	ImportsServiceLive,
	IngestionArtifactStagingProvidedLive,
	IngestionCaptureWorkflowDefinitionsProvidedLive,
	IngestionRetirementLive,
	ProcessGenericImportChunksWorkflowDefinitionsProvidedLive,
} from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { InstanceAdminServiceLive } from "#modules/instance-admin/layer";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import {
	IntegrationsServiceLive,
	IntegrationSyncWorkflowDefinitionsProvidedLive,
} from "#modules/integrations/layer";
import { IntegrationsRepository } from "#modules/integrations/repository";
import {
	NotificationDeliveryServiceLive,
	NotificationDeliveryWorkflowDefinitionsProvidedLive,
	NotificationsServiceLive,
} from "#modules/notifications/layer";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import {
	ClientArtifactGrantServiceLive,
	ClientArtifactStoreLive,
} from "#modules/pages/bundles/layer";
import { PagesServiceLive } from "#modules/pages/preparation/layer";
import { PluginCatalogHub, PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { IntegrationProviderCatalog } from "#modules/plugins/catalog/integration-providers";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginInstallationSweepDispatcherLive } from "#modules/plugins/installations/sweep";
import { PluginInstallationWorkflowDefinitionsLive } from "#modules/plugins/installations/workflow";
import {
	PluginIngestionServiceLive,
	PluginInstallationMigrationLive,
	PluginInstallationRuntimeLive,
	PluginInvalidationSubscriberLive,
} from "#modules/plugins/layer";
import {
	OperationsServiceLive,
	PluginInstallationWorkflowOperationsProvidedLive,
} from "#modules/plugins/operations/layer";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { PluginCronSchedulerProvidedLive, PluginCronServiceLive } from "#modules/scheduler/layer";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import { BackgroundWorkExecutorLive } from "#modules/scripts/executions/background-work";
import { EventProjectionBindingsLive } from "#modules/scripts/executions/event-projection-bindings";
import { SandboxExecutionQueueStoreLive } from "#modules/scripts/executions/queues";
import { SandboxWorkflowDefinitionsLive } from "#modules/scripts/executions/workflow-live";
import { SandboxHostConfigLive } from "#modules/scripts/host/sandbox-host-live";
import { SandboxWorkflowPinningLive, ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { TestSupportServicesLive } from "#modules/test-support/layer";
import { UserCommandWorkflowDefinitionsProvidedLive } from "#modules/user-commands/layer";
import { AppConfig } from "#platform/config/service";
import { MigrationsComplete } from "#platform/db/migrate";
import { PgClientLive } from "#platform/db/postgres";
import { DatabaseSession } from "#platform/db/session";
import { EgressHttpClientLive } from "#platform/egress/http-client";
import { ObservabilityLive } from "#platform/observability/observability";
import { ProKeyService } from "#platform/pro-key";
import { RedisService } from "#platform/redis";
import { ServerRun } from "#platform/server-run";
import { DownloadTickets } from "#platform/storage/download-tickets";
import { HmacSigner } from "#platform/storage/hmac-signer";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";

import { AdmittedWorkflowCatalogueLive } from "./admitted-workflows";
import { FrequentCronWorkflowDefinitionsLive } from "./cron-workflow-definitions";
import { ImportRunExecutionControllerLive } from "./import-run-execution-controller";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
import { RuntimeSandboxExecutorLive, SandboxDurableHostServicesLive } from "./script-host";
import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.layer, BunServices.layer);

const SignedUrlInfrastructureLive = Layer.provideMerge(
	Layer.mergeAll(LocalStorageService.layer, DownloadTickets.layer),
	HmacSigner.layer,
);

const BaseInfrastructureServicesLive = Layer.provideMerge(
	ExecutionFileStore.layer,
	Layer.provideMerge(
		SandboxHostConfigLive,
		Layer.mergeAll(
			PgClientLive,
			DatabaseSession.layer,
			RedisService.layer,
			SignedUrlInfrastructureLive,
			ServerRun.layer,
			S3Service.layer,
			ProKeyService.layer,
			EgressHttpClientLive,
		),
	),
);

const CoreInfrastructureDependenciesLive = BaseInfrastructureServicesLive.pipe(
	Layer.provideMerge(ConfigLive),
);

const PersistedQueueLive = PersistedQueue.layer.pipe(Layer.provide(SandboxExecutionQueueStoreLive));

const ApplicationInfrastructureLive = Layer.merge(PersistedQueueLive, WorkflowEngineLive).pipe(
	Layer.provideMerge(CoreInfrastructureDependenciesLive),
);

// Content lifecycle services cross the plugin/definition boundary during writes.
const ContentLifecycleRepositoriesLive = Layer.merge(
	PluginRepository.layer,
	DefinitionRepository.layer,
);

// One reference keeps a single sandbox runtime with ingestion staging for every consumer.
const StagedRuntimeSandboxExecutorLive = RuntimeSandboxExecutorLive.pipe(
	Layer.provide(IngestionArtifactStagingProvidedLive),
);

const ServicesLive = Layer.mergeAll(
	AuthServiceLive,
	AutomationHistoryServiceLive,
	BackupServicesLive,
	BackgroundWorkService.layer,
	CollectionsServiceLive,
	EntitiesServiceRuntimeLive,
	EntityEditorServiceLive,
	EntityImportServiceLive,
	EntityPopulationRetryServiceLive,
	EventsServiceLive,
	EventStreamWorkServiceLive.pipe(Layer.provide(EventProjectionBindingsLive)),
	InstanceAdminServiceLive,
	ImportsServiceLive,
	ImportRunCancellationService.layer.pipe(Layer.provide(ImportsRepository.layer)),
	IntegrationsServiceLive,
	InterestServicesLive,
	NotificationDeliveryServiceLive,
	NotificationsServiceLive,
	OAuthConnectionsServiceLive,
	OperationsServiceLive,
	PluginIngestionServiceLive,
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriberLive,
	PluginInstallationRuntimeLive,
	ProviderEntitySearchServiceLive,
	RelationshipsServiceLive,
	StagedRuntimeSandboxExecutorLive,
	ScriptExecutionServiceLive,
	SavedViewsServiceLive,
	CalendarSourcesServiceLive,
	RyotQLService.layer,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	TranslationsServiceLive,
	UploadServicesLive,
	UserLifecycleServiceLive,
	UserSettingsServiceLive,
	EntityUserDataServiceLive,
	UserBootstrapSchedulingLive,
	PagesServiceLive,
	ClientArtifactGrantServiceLive,
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
	Layer.provideMerge(PluginConfigEncryptionKey.layer),
	Layer.provide(Layer.merge(ContentLifecycleRepositoriesLive, AdmittedWorkflowCatalogueLive)),
);

const ServicesWithTestSupportLive = Layer.merge(
	ServicesLive,
	TestSupportServicesLive.pipe(Layer.provide(StagedRuntimeSandboxExecutorLive)),
).pipe(
	Layer.provideMerge(Layer.mergeAll(IngestionRetirementLive, PluginRuntimeResolverLive)),
	Layer.provide(AdmittedWorkflowCatalogueLive),
);

// Boot merges feature-owned definitions and keeps cross-feature composition explicit here.
const RuntimeWorkflowDefinitionsLive = Layer.mergeAll(
	CollectionMembershipWorkflowDefinitionsLive,
	AutomationRunWorkflowDefinitionsLive,
	PolicyBatchWorkflowProvidedLive,
	UserCommandWorkflowDefinitionsProvidedLive,
	ProviderEntityPopulationWorkflowDefinitionsProvidedLive,
	ProviderRelatedPagesWorkflowDefinitionsProvidedLive,
	EntityImportWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsProvidedLive,
	BackgroundWorkWorkflowLive.pipe(
		Layer.provide(Layer.merge(BackgroundWorkExecutorLive, EventProjectionFinalizerLive)),
	),
	NotificationDeliveryWorkflowDefinitionsProvidedLive,
	IntegrationSyncWorkflowDefinitionsProvidedLive,
	ImportWorkflowDefinitionsLive,
	CancelImportRunWorkflowDefinitionsLive.pipe(
		Layer.provide(Layer.merge(ImportsRepository.layer, ImportRunExecutionControllerLive)),
	),
	ProcessGenericImportChunksWorkflowDefinitionsProvidedLive,
	DataImportWorkflowDefinitionsProvidedLive,
	ExportBackupWorkflowDefinitionsLive,
	IngestionCaptureWorkflowDefinitionsProvidedLive,
	RestoreBackupWorkflowDefinitionsLive,
	UserLifecycleWorkflowDefinitionsLive,
	UserBootstrapWorkflowDefinitionsLive,
	PluginInstallationWorkflowDefinitionsLive,
	Layer.provide(
		IntegrationWorkflowDefinitionsLive,
		Layer.mergeAll(
			IntegrationProviderCatalog.layer,
			ImportsRepository.layer,
			IntegrationsRepository.layer,
		),
	),
	Layer.provide(
		SandboxWorkflowDefinitionsLive,
		Layer.mergeAll(
			SandboxRepository.layer,
			SandboxWorkflowPinningLive,
			SandboxWorkflowReferenceRepository.layer,
			KernelWorkflowReferencesLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						ImportsRepository.layer,
						IngestionCaptures.layer,
						IntegrationsRepository.layer,
						PluginRuntimeResolverLive,
						SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer)),
					),
				),
			),
		),
	),
	Layer.merge(
		TranslateEntityWorkflowDefinitionsLive,
		TranslateEntityAttemptWorkflowDefinitionsLive,
	).pipe(Layer.provide(EnrichmentRequests.layer)),
).pipe(Layer.provide(AdmittedWorkflowCatalogueLive));

const RuntimeSchedulersLive = Layer.mergeAll(
	FrequentCronSchedulerLive,
	PluginInstallationSweepDispatcherLive,
	PluginCronSchedulerProvidedLive,
	EnrichmentRecovery.liveLayer.pipe(
		Layer.provide(Layer.merge(EnrichmentRequests.layer, ScriptExecutionServiceLive)),
	),
);

const RuntimeWorkLive = Layer.merge(
	RuntimeWorkflowDefinitionsLive,
	FrequentCronWorkflowDefinitionsLive,
);

const RuntimeLive = Layer.mergeAll(RuntimeWorkLive, ServerLive, RuntimeSchedulersLive);

const MigrationBootstrapServicesLive = Layer.mergeAll(
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
	EntitiesServiceMigrationLive,
).pipe(Layer.provide(ContentLifecycleRepositoriesLive));

export const SchemaMigrationLive = MigrationsComplete.layer;

export const MigrationInfrastructureLive = Layer.mergeAll(
	MigrationBootstrapServicesLive,
	PluginInstallationMigrationLive,
	IntegrationsRepository.layer,
).pipe(
	Layer.provideMerge(AdmittedWorkflowCatalogueLive),
	Layer.provideMerge(WorkflowEngineLive),
	Layer.provideMerge(PgClientLive),
	// Legacy migration and system ingestion consume these repositories directly.
	Layer.provideMerge(
		Layer.mergeAll(ContentLifecycleRepositoriesLive, ManagedAssetsRepository.layer),
	),
	Layer.provideMerge(RedisService.layer),
	Layer.provideMerge(SignedUrlInfrastructureLive),
	Layer.provideMerge(S3Service.layer),
	Layer.provideMerge(PluginConfigEncryptionKey.layer),
	Layer.provideMerge(DatabaseSession.layer),
	Layer.provideMerge(ConfigLive),
);

// Workflow operations cross feature boundaries; boot composes their owning Layers.
const RuntimeWorkflowOperationsLive = Layer.mergeAll(
	SandboxDurableHostServicesLive,
	CollectionMembershipWorkflowOperationsLive,
	Layer.provide(AutomationRunWorkflowOperationsServiceLive, ScriptExecutionServiceLive),
	EntityImportWorkflowOperationsProvidedLive,
	Layer.provide(
		TranslateEntityWorkflowOperationsLive,
		Layer.merge(ScriptExecutionServiceLive, PluginRuntimeResolverLive),
	),
	BackupWorkflowOperationsLive,
	UserLifecycleWorkflowOperationsProvidedLive.pipe(Layer.provide(AdmittedWorkflowCatalogueLive)),
	Layer.provide(UserBootstrapWorkflowOperationsLive, UserBootstrapLive),
	PluginInstallationWorkflowOperationsProvidedLive,
);

export const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.provideMerge(RuntimeWorkflowOperationsLive, ServicesWithTestSupportLive),
	ApplicationInfrastructureLive,
);

export const RuntimeServerLive = RuntimeLive.pipe(Layer.provide(RuntimeDependenciesLive));

export const ObservabilityProvidedLive = ObservabilityLive.pipe(Layer.provide(ConfigLive));
