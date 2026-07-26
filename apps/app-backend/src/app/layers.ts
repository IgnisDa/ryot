import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "#lib/infrastructure/db/migrate";
import { DatabaseLive } from "#lib/infrastructure/db/service";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { ObservabilityLive } from "#lib/infrastructure/observability";
import { ProviderHttpAdmissionService } from "#lib/infrastructure/provider-http-admission";
import { RedisService } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { makeRuntimeSandboxApiFunctions } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { ServerRun } from "#lib/infrastructure/server-run";
import { PersistedQueueLive, WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";
import { AuthRepository } from "#modules/auth/repository";
import { AuthService } from "#modules/auth/service";
import { LifecycleDispatchLive } from "#modules/automations/lifecycle-dispatch";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { AutomationsRepository } from "#modules/automations/repository";
import { AutomationsService } from "#modules/automations/service";
import { SignalDispatchLive } from "#modules/automations/signal-dispatch";
import {
	SubscriptionExecutionWorkflowDefinitionsLive,
	SubscriptionExecutionWorkflowOperationsLive,
} from "#modules/automations/subscription-execution-workflow-live";
import { BackupExportSnapshot } from "#modules/backups/export/snapshot";
import {
	ExportBackupWorkflowDefinitionsLive,
	ExportBackupWorkflowOperationsLive,
} from "#modules/backups/export/workflow";
import { BackupAccountCleanliness } from "#modules/backups/restore/account-cleanliness";
import {
	RestoreBackupWorkflowDefinitionsLive,
	RestoreBackupWorkflowOperationsLive,
} from "#modules/backups/restore/workflow";
import { BackupRestoreWriter } from "#modules/backups/restore/writer";
import { BackupsRepository } from "#modules/backups/runs/repository";
import { BackupsService } from "#modules/backups/service";
import {
	AddEntityToCollectionWorkflowDefinitionsLive,
	AddEntityToCollectionWorkflowOperationsLive,
} from "#modules/collections/add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionsRepository } from "#modules/definitions/repository";
import { DefinitionsService } from "#modules/definitions/service";
import { LifecycleDispatchNoop } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { LocalInterestSessions } from "#modules/entity-interest/connections";
import { EntityInterestProgression } from "#modules/entity-interest/progression";
import { InterestReconciler } from "#modules/entity-interest/reconciler";
import { InterestService } from "#modules/entity-interest/service";
import { EntityInterestStore } from "#modules/entity-interest/store";
import { EntityInterestSubscriber } from "#modules/entity-interest/subscriber";
import { EntityInterestTicketService } from "#modules/entity-interest/ticket-service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { TranslateEntityWorkflowDefinitionsLive } from "#modules/entity-translation/entity-translation-workflow-live";
import { TranslateEntityWorkflowOperationsLive } from "#modules/entity-translation/operations-workflow";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { TranslationsService } from "#modules/entity-translation/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import {
	EventCreateWorkflowDefinitionsLive,
	EventCreateWorkflowOperationsLive,
} from "#modules/events/event-create-workflow-live";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { GodModeRepository } from "#modules/god-mode/repository";
import { GodModeService } from "#modules/god-mode/service";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ProcessGenericImportChunksWorkflowDefinitionsLive } from "#modules/imports/generic-import-workflow";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow-live";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import { IntegrationReconciliationWorkflowDefinitionsLive } from "#modules/integrations/reconciliation-workflow";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { NotificationDeliveryService, NotificationMailer } from "#modules/notifications/delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "#modules/notifications/notification-delivery-workflow-live";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { FirstPartyPluginBootstrap } from "#modules/plugins/boot";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { IntegrationProviderCatalogLive } from "#modules/plugins/integration-provider-catalog";
import { PluginLoaderLive } from "#modules/plugins/loader";
import { OperationsService } from "#modules/plugins/operations-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/sandbox-plugin-script-resolver-live";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";
import { PluginIngestionService, PluginInvalidationSubscriber } from "#modules/plugins/service";
import { EntityImportWorkflowDefinitionsLive } from "#modules/provider-entities/entity-import-workflow";
import { EntityImportWorkflowOperationsLive } from "#modules/provider-entities/operations-workflow";
import { EntityPopulationTriggerLive } from "#modules/provider-entities/population-trigger-live";
import { ProviderEntityPopulationWorkflowDefinitionsLive } from "#modules/provider-entities/provider-entity-population-workflow";
import { ProviderEntitySearchService } from "#modules/provider-entities/search-service";
import { EntityImportService } from "#modules/provider-entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowDefinitionsLive } from "#modules/sandbox/sandbox-workflow-live";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { SavedViewsService } from "#modules/saved-views/service";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { PluginBootDispatcherLive, PluginBootService } from "#modules/scheduler/plugin-boot";
import { PluginCronSchedulerLive, PluginCronService } from "#modules/scheduler/plugin-cron";
import { SignalsRepository } from "#modules/signals/repository";
import {
	SignalEmissionService,
	SignalSchemasService,
	SignalsService,
} from "#modules/signals/service";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";
import { OperationalGateService } from "#modules/test-support/operational-gate-service";
import { TestSupportService } from "#modules/test-support/service";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ManagedAssetsRepository } from "#modules/uploads/managed-assets/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";
import { AuthUserBootstrapLive } from "#modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";
import { UserLifecycleRepository } from "#modules/user-lifecycle/repository";
import { UserLifecycleService } from "#modules/user-lifecycle/service";
import {
	UserLifecycleWorkflowDefinitionsLive,
	UserLifecycleWorkflowOperationsLive,
} from "#modules/user-lifecycle/workflow";
import { UserSettingsService } from "#modules/user-settings/service";
import { UserStateService } from "#modules/user-state/service";

import { makeAutomationSandboxApiFunctions } from "./automation-sandbox-host-functions";
import { FrequentCronWorkflowDefinitionsLive } from "./cron-workflow-definitions";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
import {
	SandboxDurableHostDispatcherLive,
	SandboxDurableHostServiceWorkflowLive,
} from "./sandbox-durable-host-dispatcher";
import { makeAdditionalSandboxApiFunctions } from "./sandbox-host-functions";
import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.layer, BunServices.layer);

const BaseInfrastructureServicesLive = Layer.provideMerge(
	SandboxArtifactStore.layer,
	Layer.mergeAll(
		DatabaseLive,
		RedisService.layer,
		LocalStorageService.layer,
		ServerRun.layer,
		S3Service.layer,
		FetchHttpClient.layer,
	),
);

const ContentRepositoriesLive = Layer.mergeAll(
	CollectionsRepository.layer,
	EntitiesRepository.layer,
	EntitySchemasRepository.layer,
	EventSchemasRepository.layer,
	EventsRepository.layer,
	RelationshipSchemasRepository.layer,
	RelationshipsRepository.layer,
	SignalsRepository.layer,
	SignalSchemasRepository.layer,
	TranslationsRepository.layer,
);

const PlatformRepositoriesLive = Layer.mergeAll(
	AuthRepository.layer,
	AutomationsRepository.layer,
	BackupsRepository.layer,
	GodModeRepository.layer,
	ImportsRepository.layer,
	IntegrationsRepository.layer,
	NotificationsRepository.layer,
	SandboxRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
	SavedViewsRepository.layer,
	DefinitionsRepository.layer,
	PluginRepository.layer,
	ManagedAssetsRepository.layer,
	UserLifecycleRepository.layer,
);

const SandboxPluginScriptResolverLive = Layer.provideMerge(
	PluginSandboxScriptResolverLive,
	PluginRuntimeResolverLive,
);
const ImportSourceCatalogLive = Layer.provide(ImportSourceCatalog.layer, PluginLoaderLive);
const ScriptGarbageCollectorLive = Layer.provide(
	ScriptGarbageCollector.layer,
	Layer.mergeAll(
		PluginLoaderLive,
		PluginRepository.layer,
		PackageCacheManager.layer,
		SandboxWorkflowReferenceRepository.layer,
	),
);
const PluginIngestionServiceLive = Layer.provide(
	PluginIngestionService.layer,
	Layer.mergeAll(
		PluginLoaderLive,
		PluginRepository.layer,
		ScriptGarbageCollectorLive,
		SandboxWorkflowReferenceRepository.layer,
	),
);
const RepositoriesLive = Layer.provideMerge(
	Layer.mergeAll(ContentRepositoriesLive, PlatformRepositoriesLive),
	SandboxPluginScriptResolverLive,
);

const MigrationBootstrapRepositoriesLive = Layer.mergeAll(
	AutomationsRepository.layer,
	EntitiesRepository.layer,
	EntitySchemasRepository.layer,
	SavedViewsRepository.layer,
	RelationshipSchemasRepository.layer,
	SignalSchemasRepository.layer,
	DefinitionsRepository.layer,
	PluginRepository.layer,
);

const CoreInfrastructureDependenciesLive = BaseInfrastructureServicesLive.pipe(
	Layer.provideMerge(ConfigLive),
);

const CoreInfrastructureServicesLive = Layer.mergeAll(
	PersistedQueueLive,
	WorkflowEngineLive,
	RepositoriesLive,
);

const ApplicationInfrastructureLive = CoreInfrastructureServicesLive.pipe(
	Layer.provideMerge(CoreInfrastructureDependenciesLive),
);

const RyotQLServiceLive = RyotQLService.layer;
const ObjectStorageServiceLive = ObjectStorageService.layer;
const UserLifecycleGuardLive = LifecycleWriteGuard.layer;
const ManagedAssetsServiceLive = ManagedAssetsService.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(ObjectStorageServiceLive, UserLifecycleGuardLive)),
);
const UploadServicesLive = UploadIntentsService.layer.pipe(
	Layer.provideMerge(ManagedAssetsServiceLive),
);
const BackupExportSnapshotLive = BackupExportSnapshot.layer.pipe(Layer.provide(UploadServicesLive));
const BackupAccountCleanlinessLive = BackupAccountCleanliness.layer.pipe(
	Layer.provide(UploadServicesLive),
);
const BackupServicesLive = Layer.mergeAll(
	BackupRestoreWriter.layer,
	BackupExportSnapshotLive,
	BackupAccountCleanlinessLive,
	BackupsService.layer.pipe(Layer.provide([BackupAccountCleanlinessLive, UploadServicesLive])),
);
const NotificationSubscriptionsServiceLive = NotificationSubscriptionsService.layer.pipe(
	Layer.provide(AutomationsService.layer),
);

const LifecycleDispatchServiceLive = LifecycleDispatchLive.pipe(
	Layer.provide(AutomationsService.layer),
);

const EntitiesServiceLive = EntitiesService.layer.pipe(Layer.provide(LifecycleDispatchServiceLive));

const SavedViewsServiceLive = SavedViewsService.layer.pipe(Layer.provide(RyotQLServiceLive));

const BootstrapServicesLive = Layer.mergeAll(
	EntitiesServiceLive,
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
);

const AuthUserBootstrapProvidedLive = AuthUserBootstrapLive.pipe(
	Layer.provideMerge(BootstrapServicesLive),
);

const AuthAndBootstrapServicesLive = Layer.mergeAll(
	BootstrapServicesLive,
	UserLifecycleGuardLive,
	AuthService.layer.pipe(Layer.provide(AuthUserBootstrapProvidedLive)),
);
const UserLifecycleServiceLive = UserLifecycleService.layer.pipe(
	Layer.provideMerge(AuthAndBootstrapServicesLive),
);
const UserSettingsServiceLive = UserSettingsService.layer.pipe(
	Layer.provideMerge(AuthAndBootstrapServicesLive),
);
const AuthDependentServicesBaseLive = Layer.mergeAll(
	UserSettingsServiceLive,
	UserLifecycleServiceLive,
);
const GodModeServiceLive = GodModeService.layer.pipe(
	Layer.provideMerge(AuthDependentServicesBaseLive),
);
const AuthDependentServicesLive = Layer.mergeAll(AuthDependentServicesBaseLive, GodModeServiceLive);

const InterestReconcilerLive = InterestReconciler.layer.pipe(
	Layer.provide([RyotQLServiceLive, EntityPopulationTriggerLive, TranslationsService.layer]),
);

const EntityInterestStateLive = Layer.mergeAll(
	EntityInterestStore.layer,
	LocalInterestSessions.layer,
);
const EntityInterestProgressionLive = EntityInterestProgression.layer.pipe(
	Layer.provide([
		EntityInterestStateLive,
		EntitiesServiceLive,
		PluginRuntimeResolverLive,
		TranslationsService.layer,
	]),
);
const EntityInterestSubscriberLive = EntityInterestSubscriber.layer.pipe(
	Layer.provide([EntityInterestStateLive, EntityInterestProgressionLive]),
);
const InterestServiceLive = InterestService.layer.pipe(
	Layer.provide([EntityInterestStateLive, InterestReconcilerLive]),
);
const InterestServicesLive = Layer.mergeAll(
	EntityInterestStateLive,
	InterestReconcilerLive,
	InterestServiceLive,
	EntityInterestTicketService.layer,
	EntityInterestProgressionLive,
	EntityInterestSubscriberLive,
);
const EventsServiceLive = EventsService.layer;
const SignalDispatchServiceLive = SignalDispatchLive.pipe(Layer.provide(AutomationsService.layer));
const SignalEmissionServiceLive = SignalEmissionService.layer.pipe(
	Layer.provide(SignalDispatchServiceLive),
);

export const SandboxHostImplementationsLive = Layer.effect(
	SandboxHostImplementations,
	Effect.all({
		runtime: makeRuntimeSandboxApiFunctions,
		additional: makeAdditionalSandboxApiFunctions,
		automation: makeAutomationSandboxApiFunctions,
	}),
).pipe(
	Layer.provide([
		EventsServiceLive,
		RyotQLServiceLive,
		SignalEmissionServiceLive,
		NotificationsService.layer,
	]),
);

export const RuntimeSandboxServiceLive = SandboxService.layer.pipe(
	Layer.provide(SandboxHostImplementationsLive),
);

const SandboxExecutionServiceLive = SandboxExecutionService.layer.pipe(
	Layer.provide(SandboxPluginScriptResolverLive),
);

const ProviderEntitySearchServiceLive = ProviderEntitySearchService.layer.pipe(
	Layer.provide([SandboxExecutionServiceLive, PluginRuntimeResolverLive]),
);

const PluginUserBootstrapDispatcherDependenciesLive = SandboxExecutionServiceLive.pipe(
	Layer.provideMerge(PluginRuntimeResolverLive),
);

const PluginUserBootstrapDispatcherLive = PluginUserBootstrapDispatcher.layer.pipe(
	Layer.provide(PluginUserBootstrapDispatcherDependenciesLive),
);

const SandboxServicesLive = Layer.mergeAll(
	SandboxExecutionServiceLive,
	RuntimeSandboxServiceLive,
	PluginUserBootstrapDispatcherLive,
);

const ImportWorkflowPinningLive = Layer.effect(
	ImportWorkflowPinning,
	Effect.map(SandboxExecutionService, (sandbox) => ({
		preRegister: sandbox.preRegisterPluginWorkflow,
		release: sandbox.releaseWorkflowRegistration,
	})),
).pipe(Layer.provide(SandboxExecutionServiceLive));

const ContentServicesLive = Layer.mergeAll(
	AuthDependentServicesLive,
	EntityImportService.layer,
	EventsServiceLive,
	SavedViewsServiceLive,
	DefinitionsService.layer,
	RyotQLServiceLive,
	AutomationsService.layer,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasService.layer,
	SignalsService.layer,
	TranslationsService.layer,
);

const UserStateServiceLive = UserStateService.layer.pipe(
	Layer.provide([Layer.mergeAll(EventsServiceLive, RelationshipsService.layer), PluginLoaderLive]),
);

const ImportsServiceLive = ImportsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			UploadServicesLive,
			ImportSourceCatalogLive,
			ImportRunFailuresService.layer,
			ImportWorkflowPinningLive,
		),
	),
);

const PlatformServicesLive = Layer.mergeAll(
	BackupServicesLive,
	RelationshipsService.layer,
	UserStateServiceLive,
	ImportsServiceLive,
	IntegrationsService.layer.pipe(
		Layer.provide([ImportsServiceLive, IntegrationProviderCatalogLive]),
	),
	NotificationsService.layer,
	NotificationDeliveryService.layer.pipe(Layer.provide(NotificationMailer.layer)),
);

const CollectionsServiceLive = CollectionsService.layer.pipe(
	Layer.provide([EntitiesServiceLive, EventsServiceLive, RelationshipsService.layer]),
);

const ServicesBaseLive = Layer.mergeAll(ContentServicesLive, PlatformServicesLive).pipe(
	Layer.provideMerge(CollectionsServiceLive),
);

const ContentAndSandboxServicesLive = Layer.mergeAll(
	ServicesBaseLive,
	ProviderEntitySearchServiceLive,
).pipe(Layer.provideMerge(SandboxServicesLive));

const OperationsServiceLive = OperationsService.layer.pipe(
	Layer.provide([ContentAndSandboxServicesLive, IntegrationOperationScopeResolverLive]),
);

const ServicesLive = Layer.mergeAll(
	ContentAndSandboxServicesLive,
	PluginIngestionServiceLive,
	OperationsServiceLive,
	InterestServicesLive,
	LifecycleDispatchServiceLive,
	PluginBootService.layer,
	PluginCronService.layer,
);

const ServicesWithTestSupportLive = Layer.provideMerge(
	Layer.mergeAll(TestSupportService.layer, OperationalGateService.layer),
	ServicesLive,
);

const RuntimeWorkflowDefinitionsLive = Layer.mergeAll(
	AddEntityToCollectionWorkflowDefinitionsLive,
	SubscriptionExecutionWorkflowDefinitionsLive,
	ProviderEntityPopulationWorkflowDefinitionsLive,
	EntityImportWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsLive,
	NotificationDeliveryWorkflowDefinitionsLive,
	IntegrationReconciliationWorkflowDefinitionsLive,
	ImportWorkflowDefinitionsLive,
	ProcessGenericImportChunksWorkflowDefinitionsLive,
	ExportBackupWorkflowDefinitionsLive,
	RestoreBackupWorkflowDefinitionsLive,
	UserLifecycleWorkflowDefinitionsLive,
	Layer.provide(IntegrationWorkflowDefinitionsLive, IntegrationProviderCatalogLive),
	Layer.provide(SandboxWorkflowDefinitionsLive, KernelWorkflowReferencesLive),
	TranslateEntityWorkflowDefinitionsLive,
);

export const RuntimeLive = Layer.mergeAll(
	RuntimeWorkflowDefinitionsLive,
	ServerLive,
	FrequentCronWorkflowDefinitionsLive,
	FrequentCronSchedulerLive,
	PluginBootDispatcherLive,
	PluginCronSchedulerLive,
);

const FirstPartyPluginBootstrapLive = FirstPartyPluginBootstrap.layer.pipe(
	Layer.provide([PluginIngestionServiceLive, PluginRepository.layer, ScriptGarbageCollectorLive]),
);

const MigrationBootstrapDependenciesLive = Layer.mergeAll(
	LifecycleDispatchNoop,
	MigrationBootstrapRepositoriesLive,
).pipe(Layer.provideMerge(PluginRuntimeResolverLive));

const MigrationBootstrapServicesLive = Layer.mergeAll(
	NotificationSubscriptionsService.layer.pipe(Layer.provideMerge(AutomationsService.layer)),
	SavedViewsServiceLive,
	Layer.fresh(EntitiesService.layer),
	SignalSchemasService.layer,
).pipe(Layer.provideMerge(PluginLoaderLive), Layer.provide(MigrationBootstrapDependenciesLive));

const MigrationSequenceLive = MigrationsComplete.layer.pipe(
	Layer.flatMap(() => FirstPartyPluginBootstrapLive),
	Layer.flatMap(() => LegacyBootstrapMigrateDrop.layer),
);

const MigrationInfrastructureLive = MigrationBootstrapServicesLive.pipe(
	Layer.provideMerge(DatabaseLive),
	Layer.provideMerge(RedisService.layer),
	Layer.provideMerge(ConfigLive),
);

export const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.mergeAll(
		Layer.provide(
			SandboxDurableHostDispatcherLive,
			Layer.mergeAll(
				SandboxHostImplementationsLive,
				PluginHttpRateLimitAuthority.layer,
				ProviderHttpAdmissionService.layer,
			),
		),
		Layer.provide(SandboxDurableHostServiceWorkflowLive, SandboxHostImplementationsLive),
		Layer.provideMerge(
			Layer.mergeAll(
				AddEntityToCollectionWorkflowOperationsLive,
				Layer.provide(EventCreateWorkflowOperationsLive, ServicesWithTestSupportLive),
			),
			ServicesWithTestSupportLive,
		),
		Layer.provide(EntityImportWorkflowOperationsLive, SandboxExecutionServiceLive),
		Layer.provide(SubscriptionExecutionWorkflowOperationsLive, ServicesWithTestSupportLive),
		Layer.provide(TranslateEntityWorkflowOperationsLive, SandboxExecutionServiceLive),
		Layer.provide(
			Layer.mergeAll(ExportBackupWorkflowOperationsLive, RestoreBackupWorkflowOperationsLive),
			ServicesWithTestSupportLive,
		),
		Layer.provide(
			UserLifecycleWorkflowOperationsLive,
			Layer.mergeAll(ServicesWithTestSupportLive, ObjectStorageServiceLive),
		),
	),
	ApplicationInfrastructureLive,
);

export const RuntimeAfterMigrationsLive = MigrationSequenceLive.pipe(
	Layer.flatMap(() =>
		Layer.provideMerge(
			RuntimeLive,
			PluginInvalidationSubscriber.layer.pipe(Layer.provide(PluginIngestionServiceLive)),
		).pipe(Layer.provide(RuntimeDependenciesLive)),
	),
	Layer.provide(MigrationInfrastructureLive),
);

const MigrationOnlyCoreLive = MigrationSequenceLive.pipe(
	Layer.provide(MigrationInfrastructureLive),
);

const ObservabilityProvided = ObservabilityLive.pipe(Layer.provide(ConfigLive));

export const AppLive = RuntimeAfterMigrationsLive.pipe(Layer.provide(ObservabilityProvided));
export const MigrationOnlyLive = MigrationOnlyCoreLive.pipe(Layer.provide(ObservabilityProvided));
