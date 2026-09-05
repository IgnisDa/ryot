import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { MigrationsComplete } from "#lib/infrastructure/db/migrate";
import { PgClientLive } from "#lib/infrastructure/db/postgres";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { ObservabilityLive } from "#lib/infrastructure/observability";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { RedisService } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxDurableHostServicesLive } from "#lib/infrastructure/sandbox-runtime/layer";
import { ServerRun } from "#lib/infrastructure/server-run";
import { PersistedQueueLive, WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { AuthServiceLive } from "#modules/auth/layer";
import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";
import {
	AutomationHistoryServiceLive,
	AutomationReconciliationLive,
	AutomationRetentionLive,
	AutomationRunWorkflowOperationsServiceLive,
	LifecycleServicesLive,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
} from "#modules/automations/layer";
import { AutomationRunWorkflowDefinitionsLive } from "#modules/automations/run-workflow-live";
import { ExportBackupWorkflowDefinitionsLive } from "#modules/backups/export/workflow";
import { BackupServicesLive, BackupWorkflowOperationsLive } from "#modules/backups/layer";
import { RestoreBackupWorkflowDefinitionsLive } from "#modules/backups/restore/workflow";
import {
	ClientArtifactGrantServiceLive,
	ClientArtifactStoreLive,
} from "#modules/client-artifacts/layer";
import {
	ClientDocumentGrantServiceLive,
	ClientPagesServiceLive,
	ClientSurfaceMaterializerLive,
} from "#modules/client-pages/layer";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import {
	AddEntityToCollectionWorkflowDefinitionsLive,
	AddEntityToCollectionWorkflowOperationsLive,
} from "#modules/collections/add-entity-to-collection-workflow-live";
import { CollectionsServiceLive } from "#modules/collections/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesServiceMigrationLive, EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { InterestServicesLive } from "#modules/entity-interest/layer";
import { TranslateEntityWorkflowDefinitionsLive } from "#modules/entity-translation/entity-translation-workflow-live";
import { TranslationsServiceLive } from "#modules/entity-translation/layer";
import { TranslateEntityWorkflowOperationsLive } from "#modules/entity-translation/operations-workflow";
import {
	EventCreateWorkflowDefinitionsProvidedLive,
	EventsServiceLive,
} from "#modules/events/layer";
import { GodModeServiceLive } from "#modules/god-mode/layer";
import { CancelImportRunWorkflowDefinitionsLive } from "#modules/imports/cancel-workflow";
import { ImportRunCancellationService } from "#modules/imports/cancellation-service";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow-live";
import {
	ImportsServiceLive,
	ProcessGenericImportChunksWorkflowDefinitionsProvidedLive,
} from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
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
import { PluginCatalogHub } from "#modules/plugins/catalog-events";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginInstallationSweepDispatcherLive } from "#modules/plugins/installation-sweep";
import { PluginInstallationWorkflowDefinitionsLive } from "#modules/plugins/installation-workflow";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import {
	PluginInstallationMigrationLive,
	PluginInstallationRuntimeLive,
	PluginIngestionServiceLive,
	PluginInvalidationSubscriberLive,
} from "#modules/plugins/layer";
import {
	OperationsServiceLive,
	PluginInstallationWorkflowOperationsProvidedLive,
} from "#modules/plugins/operations-layer";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { EntityImportWorkflowDefinitionsLive } from "#modules/provider-entities/entity-import-workflow";
import {
	EntityImportServiceLive,
	EntityImportWorkflowOperationsProvidedLive,
	ProviderEntityPopulationWorkflowDefinitionsProvidedLive,
	ProviderEntitySearchServiceLive,
} from "#modules/provider-entities/layer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RyotQLService } from "#modules/ryotql/service";
import {
	RuntimeSandboxServiceLive,
	SandboxExecutionServiceLive,
	SandboxWorkflowPinningLive,
} from "#modules/sandbox/layer";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowDefinitionsLive } from "#modules/sandbox/sandbox-workflow-live";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { PluginCronSchedulerProvidedLive, PluginCronServiceLive } from "#modules/scheduler/layer";
import { SignalSchemasServiceLive } from "#modules/signals/layer";
import { TestSupportServicesLive } from "#modules/test-support/layer";
import { ObjectStorageServiceLive, UploadServicesLive } from "#modules/uploads/layer";
import { ManagedAssetsRepository } from "#modules/uploads/managed-assets/repository";
import { UserBootstrapSchedulingLive, UserBootstrapLive } from "#modules/user-bootstrap/layer";
import {
	UserBootstrapWorkflowDefinitionsLive,
	UserBootstrapWorkflowOperationsLive,
} from "#modules/user-bootstrap/workflow";
import {
	UserLifecycleServiceLive,
	UserLifecycleWorkflowOperationsProvidedLive,
} from "#modules/user-lifecycle/layer";
import { UserLifecycleWorkflowDefinitionsLive } from "#modules/user-lifecycle/workflow";
import { UserSettingsServiceLive } from "#modules/user-settings/layer";
import { UserStateServiceLive } from "#modules/user-state/layer";

import { FrequentCronWorkflowDefinitionsLive } from "./cron-workflow-definitions";
import { ImportRunExecutionControllerLive } from "./import-run-execution-controller";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
import { ServerLive } from "./server";

export { InternalOAuthProvisioningLive } from "#modules/auth/layer";
export { SystemPluginIngestionLive } from "#modules/plugins/layer";

const ConfigLive = Layer.mergeAll(AppConfig.layer, BunServices.layer);

const BaseInfrastructureServicesLive = Layer.provideMerge(
	SandboxArtifactStore.layer,
	Layer.mergeAll(
		PgClientLive,
		DatabaseSession.layer,
		RedisService.layer,
		LocalStorageService.layer,
		ServerRun.layer,
		S3Service.layer,
		ProKeyService.layer,
		FetchHttpClient.layer,
	),
);

const CoreInfrastructureDependenciesLive = BaseInfrastructureServicesLive.pipe(
	Layer.provideMerge(ConfigLive),
);

const ApplicationInfrastructureLive = Layer.merge(PersistedQueueLive, WorkflowEngineLive).pipe(
	Layer.provideMerge(CoreInfrastructureDependenciesLive),
);

// Content lifecycle services cross the plugin/definition boundary during writes.
const ContentLifecycleRepositoriesLive = Layer.merge(
	PluginRepository.layer,
	DefinitionRepository.layer,
);

const ServicesLive = Layer.mergeAll(
	AuthServiceLive,
	AutomationHistoryServiceLive,
	BackupServicesLive,
	CollectionsServiceLive,
	EntitiesServiceRuntimeLive,
	EntityImportServiceLive,
	EventsServiceLive,
	GodModeServiceLive,
	ImportsServiceLive,
	ImportRunCancellationService.layer.pipe(Layer.provide(ImportsRepository.layer)),
	IntegrationsServiceLive,
	InterestServicesLive,
	NotificationDeliveryServiceLive,
	NotificationsServiceLive,
	OperationsServiceLive,
	PluginIngestionServiceLive,
	PluginInvalidationSubscriberLive,
	PluginInstallationRuntimeLive,
	ProviderEntitySearchServiceLive,
	RelationshipsServiceLive,
	RuntimeSandboxServiceLive,
	SandboxExecutionServiceLive,
	SavedViewsServiceLive,
	RyotQLService.layer,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasServiceLive,
	TranslationsServiceLive,
	UploadServicesLive,
	UserLifecycleServiceLive,
	UserSettingsServiceLive,
	UserStateServiceLive,
	UserBootstrapSchedulingLive,
	ClientPagesServiceLive,
	ClientDocumentGrantServiceLive,
	ClientArtifactGrantServiceLive,
	ClientArtifactStoreLive,
	AutomationReconciliationLive,
	AutomationRetentionLive,
	PluginConfigEncryptionKey.layer,
	PluginCronServiceLive,
	LifecycleServicesLive,
	// HTTP routes consume these ports directly.
	ClientPagesRepository.layer,
	LifecycleWriteGuard.layer,
	ObjectStorageServiceLive,
	PluginCatalogHub.layer,
).pipe(Layer.provide(ContentLifecycleRepositoriesLive));

const ServicesWithTestSupportLive = Layer.merge(ServicesLive, TestSupportServicesLive);

// Boot merges feature-owned definitions and keeps cross-feature composition explicit here.
const RuntimeWorkflowDefinitionsLive = Layer.mergeAll(
	AddEntityToCollectionWorkflowDefinitionsLive,
	AutomationRunWorkflowDefinitionsLive,
	ProviderEntityPopulationWorkflowDefinitionsProvidedLive,
	EntityImportWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsProvidedLive,
	NotificationDeliveryWorkflowDefinitionsProvidedLive,
	IntegrationSyncWorkflowDefinitionsProvidedLive,
	ImportWorkflowDefinitionsLive,
	CancelImportRunWorkflowDefinitionsLive.pipe(
		Layer.provide(Layer.merge(ImportsRepository.layer, ImportRunExecutionControllerLive)),
	),
	ProcessGenericImportChunksWorkflowDefinitionsProvidedLive,
	ExportBackupWorkflowDefinitionsLive,
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
						IntegrationsRepository.layer,
						PluginRuntimeResolverLive,
					),
				),
			),
		),
	),
	TranslateEntityWorkflowDefinitionsLive,
);

export const RuntimeLive = Layer.mergeAll(
	RuntimeWorkflowDefinitionsLive,
	ServerLive,
	FrequentCronWorkflowDefinitionsLive,
	FrequentCronSchedulerLive,
	PluginInstallationSweepDispatcherLive,
	PluginCronSchedulerProvidedLive,
);

const MigrationBootstrapServicesLive = Layer.mergeAll(
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
	EntitiesServiceMigrationLive,
	SignalSchemasServiceLive,
).pipe(Layer.provide(ContentLifecycleRepositoriesLive));

export const SchemaMigrationLive = MigrationsComplete.layer;

export const MigrationInfrastructureLive = Layer.mergeAll(
	MigrationBootstrapServicesLive,
	PluginInstallationMigrationLive,
	IntegrationsRepository.layer,
).pipe(
	Layer.provideMerge(ClientSurfaceMaterializerLive),
	Layer.provideMerge(PgClientLive),
	// Legacy migration and system ingestion consume these repositories directly.
	Layer.provideMerge(
		Layer.mergeAll(ContentLifecycleRepositoriesLive, ManagedAssetsRepository.layer),
	),
	Layer.provideMerge(RedisService.layer),
	Layer.provideMerge(LocalStorageService.layer),
	Layer.provideMerge(S3Service.layer),
	Layer.provideMerge(DatabaseSession.layer),
	Layer.provideMerge(ConfigLive),
);

// Workflow operations cross feature boundaries; boot composes their owning Layers.
const RuntimeWorkflowOperationsLive = Layer.mergeAll(
	SandboxDurableHostServicesLive,
	AddEntityToCollectionWorkflowOperationsLive,
	Layer.provide(AutomationRunWorkflowOperationsServiceLive, SandboxExecutionServiceLive),
	EntityImportWorkflowOperationsProvidedLive,
	Layer.provide(
		TranslateEntityWorkflowOperationsLive,
		Layer.merge(SandboxExecutionServiceLive, PluginRuntimeResolverLive),
	),
	BackupWorkflowOperationsLive,
	UserLifecycleWorkflowOperationsProvidedLive,
	Layer.provide(UserBootstrapWorkflowOperationsLive, UserBootstrapLive),
	PluginInstallationWorkflowOperationsProvidedLive,
);

export const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.provideMerge(
		Layer.provideMerge(RuntimeWorkflowOperationsLive, ServicesWithTestSupportLive),
		ClientSurfaceMaterializerLive,
	),
	ApplicationInfrastructureLive,
);

export const RuntimeServerLive = RuntimeLive.pipe(Layer.provide(RuntimeDependenciesLive));

export const ObservabilityProvidedLive = ObservabilityLive.pipe(Layer.provide(ConfigLive));
