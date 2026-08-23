import { BunServices } from "@effect/platform-bun";
import { encodePluginCatalogInvalidatedMessage } from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { isNotNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { MigrationsComplete } from "#lib/infrastructure/db/migrate";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { ObservabilityLive } from "#lib/infrastructure/observability";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { ProviderHttpAdmissionService } from "#lib/infrastructure/provider-http-admission";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeAutomationSandboxApiFunctions } from "#lib/infrastructure/sandbox-runtime/automation-host-functions";
import {
	SandboxDurableHostDispatcherLive,
	SandboxDurableHostServiceWorkflowLive,
} from "#lib/infrastructure/sandbox-runtime/durable-host-dispatcher";
import {
	makeAdditionalSandboxApiFunctions,
	makeSandboxLifecycleHostApi,
} from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { makeRuntimeSandboxApiFunctions } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { ServerRun } from "#lib/infrastructure/server-run";
import { PersistedQueueLive, WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";
import {
	InternalOAuthProvisioningComplete,
	OAuthProvisioningService,
} from "#modules/auth/oauth-provisioning";
import { AuthRepository } from "#modules/auth/repository";
import { AuthService } from "#modules/auth/service";
import { AutomationAttemptRepository } from "#modules/automations/attempt-repository";
import {
	AutomationExecutionOperationsLive,
	LifecycleExecutionLive,
} from "#modules/automations/execution";
import { AutomationHistoryRepository } from "#modules/automations/history-repository";
import { AutomationHistoryService } from "#modules/automations/history-service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { LifecyclePlannerLive } from "#modules/automations/planner";
import {
	AutomationReconciliation,
	AutomationReconciliationOperationsLive,
} from "#modules/automations/reconciliation";
import { AutomationsRepository } from "#modules/automations/repository";
import { AutomationRetention } from "#modules/automations/retention";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import {
	AutomationRunWorkflowDefinitionsLive,
	AutomationRunWorkflowOperationsLive,
} from "#modules/automations/run-workflow-live";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
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
import { ClientPageBuildService } from "#modules/client-pages/build-service";
import { ClientPageArtifactGrantService } from "#modules/client-pages/grant-service";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import { ClientPagesService } from "#modules/client-pages/service";
import {
	AddEntityToCollectionWorkflowDefinitionsLive,
	AddEntityToCollectionWorkflowOperationsLive,
} from "#modules/collections/add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
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
import { EventCreateWorkflowDefinitionsLive } from "#modules/events/event-create-workflow-live";
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
import {
	IntegrationPluginRevisionActivationLive,
	IntegrationsRepository,
} from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { IntegrationSyncWorkflowDefinitionsLive } from "#modules/integrations/sync-workflow-live";
import { NotificationDeliveryService, NotificationMailer } from "#modules/notifications/delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "#modules/notifications/notification-delivery-workflow-live";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { PluginBackupRestore } from "#modules/plugins/backup-restore";
import { SystemPluginBootstrap } from "#modules/plugins/boot";
import {
	PluginCatalogHub,
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorLive,
	PluginInvalidationSubscriber,
} from "#modules/plugins/catalog-events";
import { publishAfterCatalogMaterialization } from "#modules/plugins/catalog-materialization";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { PluginIngestionLock } from "#modules/plugins/ingestion-lock";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginInstallationSweepDispatcherLive } from "#modules/plugins/installation-sweep";
import {
	PluginInstallationLifecycleDispatcher,
	PluginInstallationLifecycleDispatcherLive,
	PluginInstallationWorkflowDefinitionsLive,
	PluginInstallationWorkflowOperationsLive,
} from "#modules/plugins/installation-workflow";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { OperationsService } from "#modules/plugins/operations-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/sandbox-plugin-script-resolver-live";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";
import { PluginIngestionService } from "#modules/plugins/service";
import { SystemPlugins } from "#modules/plugins/system";
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
import {
	SavedViewPluginDefinitionMaterializerLive,
	SavedViewsService,
} from "#modules/saved-views/service";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { PluginCronSchedulerLive, PluginCronService } from "#modules/scheduler/plugin-cron";
import { SignalSchemasService } from "#modules/signals/service";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";
import { BenchmarkProfilingService } from "#modules/test-support/benchmark-profiling-service";
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

import { FrequentCronWorkflowDefinitionsLive } from "./cron-workflow-definitions";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
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
		ProKeyService.layer,
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
	SignalSchemasRepository.layer,
	TranslationsRepository.layer,
);

const AutomationRepositoriesLive = Layer.mergeAll(
	AutomationAttemptRepository.layer,
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
);

const PlatformRepositoriesLive = Layer.mergeAll(
	AuthRepository.layer,
	AutomationRepositoriesLive,
	AutomationHistoryRepository.layer,
	AutomationsRepository.layer,
	BackupsRepository.layer,
	GodModeRepository.layer,
	ImportsRepository.layer,
	IntegrationsRepository.layer,
	NotificationsRepository.layer,
	SandboxRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
	SavedViewsRepository.layer,
	ClientPagesRepository.layer,
	PluginInstallationRepository.layer,
	PluginRepository.layer,
	ManagedAssetsRepository.layer,
	UserLifecycleRepository.layer,
);

const SandboxPluginScriptResolverLive = Layer.provideMerge(
	PluginSandboxScriptResolverLive,
	PluginRuntimeResolverLive,
);
const ScriptGarbageCollectorLive = Layer.provide(
	ScriptGarbageCollector.layer,
	Layer.mergeAll(PluginRepository.layer, PackageCacheManager.layer),
);
const PluginRevisionActivationLive = IntegrationPluginRevisionActivationLive.pipe(
	Layer.provide(IntegrationsRepository.layer),
);
const ClientPageBuildServiceLive = ClientPageBuildService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(ClientPagesRepository.layer, PluginRepository.layer, ClientPluginCompiler.layer),
	),
);
const ClientPageArtifactGrantServiceLive = ClientPageArtifactGrantService.layer.pipe(
	Layer.provide(Layer.mergeAll(ClientPagesRepository.layer, RedisService.layer)),
);
const ClientPagesServiceLive = ClientPagesService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientPagesRepository.layer,
			EntitiesRepository.layer.pipe(Layer.provide(PluginRuntimeResolverLive)),
			ClientPageBuildServiceLive,
			ClientPageArtifactGrantServiceLive,
			PluginCatalogInvalidatorLive,
			PluginRepository.layer,
			PluginRuntimeResolverLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
const ClientSurfaceMaterializerLive = Layer.effect(
	ClientSurfaceMaterializer,
	Effect.gen(function* () {
		const pages = yield* ClientPagesService;
		const db = yield* Database;
		return {
			materializeUser: (userId) =>
				pages.materializeUser(userId).pipe(Effect.provideService(Database, db), Effect.orDie),
			materializeRenderer: (userId, renderer) =>
				pages
					.materializeRenderer(userId, renderer)
					.pipe(Effect.provideService(Database, db), Effect.orDie),
			materializePendingInstallation: (userId, installationId) =>
				pages
					.materializePendingInstallation(userId, installationId)
					.pipe(Effect.provideService(Database, db), Effect.orDie),
		};
	}),
).pipe(Layer.provide(ClientPagesServiceLive));
const PluginInvalidationSubscriberLive = PluginInvalidationSubscriber.layer.pipe(
	Layer.provide(PluginCatalogHub.layer),
);
const RepositoriesLive = Layer.provideMerge(
	Layer.mergeAll(ContentRepositoriesLive, PlatformRepositoriesLive),
	Layer.mergeAll(
		SandboxPluginScriptResolverLive,
		PluginRuntimeResolverLive,
		DefinitionRepository.layer,
	),
);

const MigrationBootstrapRepositoriesLive = Layer.provideMerge(
	Layer.mergeAll(
		AutomationsRepository.layer,
		EntitiesRepository.layer,
		EntitySchemasRepository.layer,
		ManagedAssetsRepository.layer,
		SavedViewsRepository.layer,
		RelationshipSchemasRepository.layer,
		SignalSchemasRepository.layer,
		PluginInstallationRepository.layer,
		PluginRepository.layer,
	),
	Layer.merge(PluginRuntimeResolverLive, DefinitionRepository.layer),
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

const PluginConfigEncryptionKeyLive = PluginConfigEncryptionKey.layer;

const LifecyclePlannerServiceLive = LifecyclePlannerLive.pipe(
	Layer.provide(DefinitionRepository.layer),
);
const AutomationExecutionOperationsServiceLive = AutomationExecutionOperationsLive.pipe(
	Layer.provide(AutomationRunRepository.layer),
);
const LifecycleExecutionServiceLive = LifecycleExecutionLive.pipe(
	Layer.provide(AutomationExecutionOperationsServiceLive),
);
const LifecycleServicesLive = Layer.mergeAll(
	LifecyclePlannerServiceLive,
	LifecycleExecutionServiceLive,
);
const MigrationLifecycleServicesLive = LifecycleServicesLive.pipe(
	Layer.provide(WorkflowEngineLive),
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
const NotificationSubscriptionsServiceLive = NotificationSubscriptionsService.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
);

const EntitiesServiceLive = EntitiesService.layer.pipe(Layer.provide(LifecycleServicesLive));

const SavedViewsServiceLive = SavedViewsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			RyotQLServiceLive,
			SavedViewsRepository.layer,
			ClientPagesRepository.layer,
			DefinitionRepository.layer,
			PluginRuntimeResolverLive,
			PluginInstallationRepository.layer,
			PluginCatalogInvalidatorLive,
			ClientSurfaceMaterializerLive,
		),
	),
);
const MaterializingPluginCatalogInvalidatorLive = Layer.effect(
	PluginCatalogInvalidator,
	Effect.gen(function* () {
		const pages = yield* ClientPagesService;
		const savedViews = yield* SavedViewsService;
		const redis = yield* RedisService;
		const db = yield* Database;
		const refreshViews = (userId: UserId) =>
			savedViews.ensureBuiltinViews(userId).pipe(Effect.provideService(Database, db));
		const materialize = (userId: UserId) =>
			pages.materializeUser(userId).pipe(Effect.provideService(Database, db));
		return {
			user: (userId: UserId) =>
				publishAfterCatalogMaterialization(
					Effect.succeed([userId]),
					refreshViews,
					materialize,
					redis.publish(
						redisKeys.pluginCatalogUserChannel,
						encodePluginCatalogInvalidatedMessage({ userId }),
					),
				).pipe(Effect.asVoid, Effect.orDie),
			all: publishAfterCatalogMaterialization(
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(isNotNull(schema.user.bootstrapCompletedAt))
					.pipe(Effect.map((users) => users.map((user) => UserId.make(user.id)))),
				refreshViews,
				materialize,
				redis
					.publish(redisKeys.pluginCatalogChannel, "plugin-catalog-invalidated")
					.pipe(Effect.asVoid),
			).pipe(Effect.provideService(Database, db), Effect.orDie),
		};
	}),
).pipe(
	Layer.provide(Layer.mergeAll(ClientPagesServiceLive, SavedViewsServiceLive)),
	Layer.provide(RedisService.layer),
);
const PluginIngestionServiceLive = Layer.provide(
	PluginIngestionService.layer,
	Layer.mergeAll(
		PluginRevisionActivationLive,
		PluginRepository.layer,
		DefinitionRepository.layer,
		ClientPluginCompiler.layer,
		SystemPlugins.layer,
		MaterializingPluginCatalogInvalidatorLive,
	),
);
const PluginCatalogStateLive = Layer.mergeAll(PluginCatalogHub.layer, PluginIngestionServiceLive);
const PluginDefinitionMaterializerLive = SavedViewPluginDefinitionMaterializerLive.pipe(
	Layer.provide(SavedViewsServiceLive),
);
const PluginIngestionLockLive = PluginIngestionLock.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PluginRepository.layer,
			PluginRevisionActivationLive,
			PluginInstallationRepository.layer,
		),
	),
);
const BackupExportSnapshotLive = BackupExportSnapshot.layer.pipe(
	Layer.provide(Layer.mergeAll(UploadServicesLive, PluginRuntimeResolverLive)),
);
const BackupAccountCleanlinessLive = BackupAccountCleanliness.layer.pipe(
	Layer.provide(UploadServicesLive),
);
const BackupServicesLive = Layer.mergeAll(
	BackupRestoreWriter.layer,
	PluginBackupRestore.layer.pipe(
		Layer.provide(Layer.mergeAll(PluginIngestionLockLive, ClientPluginCompiler.layer)),
	),
	BackupExportSnapshotLive,
	BackupAccountCleanlinessLive,
	BackupsService.layer.pipe(Layer.provide([BackupAccountCleanlinessLive, UploadServicesLive])),
);
const pluginInstallationServiceDependencies = Layer.mergeAll(
	DefinitionRepository.layer,
	UploadServicesLive,
	ObjectStorageServiceLive,
	PluginRepository.layer,
	PluginIngestionLockLive,
	ClientPluginCompiler.layer,
	PluginDefinitionMaterializerLive,
	PluginInstallationRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
);

// Migration and shipped-system ingestion never install a private plugin, so they keep the no-op
// lifecycle dispatcher and stay free of any `WorkflowEngine` requirement.
const PluginInstallationServiceLive = Layer.provide(
	PluginInstallationService.layer,
	Layer.mergeAll(
		pluginInstallationServiceDependencies,
		PluginCatalogInvalidator.layer,
		PluginInstallationLifecycleDispatcher.layer,
	),
);

// `Layer.fresh` is load-bearing. Both variants wrap the same `PluginInstallationService.layer`
// object, and layers memoize by object identity, so without it `RuntimeAfterMigrationsLive` would
// build the migration variant first and hand the runtime its no-op dispatcher, stranding every
// private installation in `installing` forever.
const RuntimePluginInstallationServiceLive = Layer.provide(
	Layer.fresh(PluginInstallationService.layer),
	Layer.mergeAll(
		pluginInstallationServiceDependencies,
		MaterializingPluginCatalogInvalidatorLive,
		PluginInstallationLifecycleDispatcherLive,
	),
);

const BootstrapServicesLive = Layer.mergeAll(
	EntitiesServiceLive,
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
);

const AuthUserBootstrapProvidedLive = AuthUserBootstrapLive.pipe(
	Layer.provide(ClientSurfaceMaterializerLive),
	Layer.provideMerge(BootstrapServicesLive),
);

const AuthAndBootstrapServicesLive = Layer.mergeAll(
	BootstrapServicesLive,
	UserLifecycleGuardLive,
	AuthService.layer.pipe(
		Layer.provide(AuthUserBootstrapProvidedLive),
		Layer.provide(AuthRepository.layer),
	),
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
const SignalEmissionServiceLive = SignalEmissionService.layer.pipe(
	Layer.provide(LifecycleServicesLive),
);

export const SandboxHostImplementationsLive = Layer.effect(
	SandboxHostImplementations,
	Effect.all({
		lifecycle: makeSandboxLifecycleHostApi,
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
	Layer.provideMerge(Layer.mergeAll(PluginRuntimeResolverLive, PluginInstallationRepository.layer)),
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
		release: sandbox.releaseWorkflowRegistration,
		preRegister: sandbox.preRegisterPluginWorkflow,
	})),
).pipe(Layer.provide(SandboxExecutionServiceLive));

const AutomationRunWorkflowOperationsServiceLive = AutomationRunWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(AutomationRepositoriesLive, SandboxExecutionServiceLive).pipe(
			Layer.provideMerge(SandboxRepository.layer),
		),
	),
);

const AutomationHistoryServiceLive = AutomationHistoryService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationAttemptRepository.layer,
			AutomationExecutionOperationsServiceLive,
			AutomationHistoryRepository.layer,
			AutomationTriggerRepository.layer,
		),
	),
);

const AutomationReconciliationOperationsServiceLive = AutomationReconciliationOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(AutomationExecutionOperationsServiceLive, AutomationRunRepository.layer),
	),
);
const AutomationReconciliationLive = AutomationReconciliation.layer.pipe(
	Layer.provide(AutomationReconciliationOperationsServiceLive),
);
const AutomationRetentionLive = AutomationRetention.layer.pipe(
	Layer.provide(Layer.mergeAll(AutomationRepositoriesLive, ScriptGarbageCollectorLive)),
);

const RelationshipsServiceLive = RelationshipsService.layer.pipe(
	Layer.provide([PluginRuntimeResolverLive, LifecycleServicesLive]),
);

const ContentServicesLive = Layer.mergeAll(
	AuthDependentServicesLive,
	AutomationHistoryServiceLive,
	EntityImportService.layer,
	EventsServiceLive,
	SavedViewsServiceLive,
	RyotQLServiceLive,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasService.layer,
	TranslationsService.layer,
);

const UserStateServiceLive = UserStateService.layer.pipe(
	Layer.provide([
		Layer.mergeAll(EventsServiceLive, RelationshipsServiceLive),
		PluginRuntimeResolverLive,
	]),
);

const ImportsServiceLive = ImportsService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			UploadServicesLive,
			ImportSourceCatalog.layer,
			ImportRunFailuresService.layer,
			ImportWorkflowPinningLive,
		),
	),
);

const PlatformServicesLive = Layer.mergeAll(
	BackupServicesLive,
	RelationshipsServiceLive,
	UserStateServiceLive,
	ImportsServiceLive,
	IntegrationsService.layer.pipe(
		Layer.provide([ImportsServiceLive, IntegrationProviderCatalog.layer]),
	),
	NotificationsService.layer,
	NotificationDeliveryService.layer.pipe(Layer.provide(NotificationMailer.layer)),
);

const CollectionsServiceLive = CollectionsService.layer.pipe(
	Layer.provide([
		EntitiesServiceLive,
		EventsServiceLive,
		RelationshipsServiceLive,
		LifecycleServicesLive,
	]),
);

const ServicesBaseLive = Layer.mergeAll(ContentServicesLive, PlatformServicesLive).pipe(
	Layer.provideMerge(CollectionsServiceLive),
);

const ContentAndSandboxServicesLive = Layer.mergeAll(
	ServicesBaseLive,
	ProviderEntitySearchServiceLive,
).pipe(
	Layer.provideMerge(Layer.mergeAll(SandboxServicesLive, RuntimePluginInstallationServiceLive)),
);

const OperationsServiceLive = OperationsService.layer.pipe(
	Layer.provide([
		PluginRepository.layer,
		ContentAndSandboxServicesLive,
		IntegrationOperationScopeResolverLive,
	]),
);

const ServicesLive = Layer.provideMerge(
	Layer.mergeAll(
		PluginCatalogStateLive,
		PluginInvalidationSubscriberLive,
		ContentAndSandboxServicesLive,
		ClientPagesServiceLive,
		ClientPageArtifactGrantServiceLive,
		RuntimePluginInstallationServiceLive,
		OperationsServiceLive,
		InterestServicesLive,
		AutomationReconciliationLive,
		AutomationRetentionLive,
		PluginConfigEncryptionKeyLive,
		PluginCronService.layer,
	),
	LifecycleServicesLive,
);

const ServicesWithTestSupportLive = Layer.provideMerge(
	Layer.mergeAll(
		TestSupportService.layer,
		BenchmarkProfilingService.layer,
		OperationalGateService.layer.pipe(Layer.provide(PluginRuntimeResolverLive)),
	),
	ServicesLive,
);

const RuntimeWorkflowDefinitionsLive = Layer.mergeAll(
	AddEntityToCollectionWorkflowDefinitionsLive,
	AutomationRunWorkflowDefinitionsLive,
	ProviderEntityPopulationWorkflowDefinitionsLive,
	EntityImportWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsLive,
	NotificationDeliveryWorkflowDefinitionsLive,
	IntegrationSyncWorkflowDefinitionsLive,
	ImportWorkflowDefinitionsLive,
	ProcessGenericImportChunksWorkflowDefinitionsLive,
	ExportBackupWorkflowDefinitionsLive,
	RestoreBackupWorkflowDefinitionsLive,
	UserLifecycleWorkflowDefinitionsLive,
	PluginInstallationWorkflowDefinitionsLive,
	Layer.provide(IntegrationWorkflowDefinitionsLive, IntegrationProviderCatalog.layer),
	Layer.provide(SandboxWorkflowDefinitionsLive, KernelWorkflowReferencesLive),
	TranslateEntityWorkflowDefinitionsLive,
);

export const RuntimeLive = Layer.mergeAll(
	RuntimeWorkflowDefinitionsLive,
	ServerLive,
	FrequentCronWorkflowDefinitionsLive,
	FrequentCronSchedulerLive,
	PluginInstallationSweepDispatcherLive,
	PluginCronSchedulerLive,
);

export const SystemPluginIngestionLive = SystemPluginBootstrap.layer.pipe(
	Layer.provide([
		PluginIngestionServiceLive,
		PluginRepository.layer,
		DefinitionRepository.layer,
		ScriptGarbageCollectorLive,
		PluginInstallationServiceLive,
		SystemPlugins.layer,
	]),
);

const MigrationBootstrapDependenciesLive = MigrationBootstrapRepositoriesLive.pipe(
	Layer.provideMerge(PluginRuntimeResolverLive),
);

const MigrationBootstrapServicesLive = Layer.mergeAll(
	NotificationSubscriptionsService.layer,
	SavedViewsServiceLive,
	Layer.fresh(EntitiesService.layer).pipe(Layer.provide(MigrationLifecycleServicesLive)),
	SignalSchemasService.layer,
).pipe(
	Layer.provideMerge(Layer.merge(DefinitionRepository.layer, PluginRepository.layer)),
	Layer.provide(MigrationBootstrapDependenciesLive),
);

export const SchemaMigrationLive = MigrationsComplete.layer;

export const InternalOAuthProvisioningLive = InternalOAuthProvisioningComplete.layer.pipe(
	Layer.provide(OAuthProvisioningService.layer),
	Layer.provide(AuthRepository.layer),
);

export const MigrationInfrastructureLive = Layer.mergeAll(
	MigrationBootstrapServicesLive,
	PluginInstallationServiceLive,
	IntegrationsRepository.layer,
).pipe(
	Layer.provideMerge(ClientSurfaceMaterializerLive),
	Layer.provideMerge(DatabaseLive),
	Layer.provideMerge(ManagedAssetsRepository.layer),
	Layer.provideMerge(RedisService.layer),
	Layer.provideMerge(LocalStorageService.layer),
	Layer.provideMerge(S3Service.layer),
	Layer.provideMerge(ConfigLive),
);

export const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.provideMerge(
		Layer.provideMerge(
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
				Layer.mergeAll(
					AddEntityToCollectionWorkflowOperationsLive,
					AutomationRunWorkflowOperationsServiceLive,
				),
				Layer.provide(
					EntityImportWorkflowOperationsLive,
					Layer.mergeAll(LifecycleServicesLive, SandboxExecutionServiceLive),
				),
				Layer.provide(TranslateEntityWorkflowOperationsLive, SandboxExecutionServiceLive),
				Layer.provide(
					Layer.mergeAll(ExportBackupWorkflowOperationsLive, RestoreBackupWorkflowOperationsLive),
					ServicesWithTestSupportLive,
				),
				Layer.provide(
					UserLifecycleWorkflowOperationsLive,
					Layer.mergeAll(
						ServicesWithTestSupportLive,
						ObjectStorageServiceLive,
						ClientSurfaceMaterializerLive,
					),
				),
				Layer.provide(
					PluginInstallationWorkflowOperationsLive,
					Layer.mergeAll(
						SandboxExecutionServiceLive,
						MaterializingPluginCatalogInvalidatorLive,
						ClientSurfaceMaterializerLive,
						PluginDefinitionMaterializerLive,
						PluginInstallationRepository.layer,
					),
				),
			),
			ServicesWithTestSupportLive,
		),
		ClientSurfaceMaterializerLive,
	),
	ApplicationInfrastructureLive,
);

export const RuntimeServerLive = RuntimeLive.pipe(
	Layer.provide(RuntimeDependenciesLive),
	Layer.provide(LifecycleServicesLive.pipe(Layer.provide(ApplicationInfrastructureLive))),
);

export const ObservabilityProvidedLive = ObservabilityLive.pipe(Layer.provide(ConfigLive));
