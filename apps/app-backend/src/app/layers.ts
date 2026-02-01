import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "#lib/infrastructure/db/migrate";
import { DbService, DbRunnerLive, TransactionRunnerLive } from "#lib/infrastructure/db/service";
import { ObservabilityLive } from "#lib/infrastructure/observability";
import { RedisService } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { ServerRun } from "#lib/infrastructure/server-run";
import { PersistedQueueLive, WorkflowEngineLive } from "#lib/infrastructure/workflow";
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
import { SeedService } from "#modules/builtins/seed";
import { AddEntityToCollectionWorkflowDefinitionsLive } from "#modules/collections/add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { LifecycleDispatchNoop } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityImportWorkflowOperationsLive } from "#modules/entity-import/operations-workflow";
import { EntityPopulationTriggerLive } from "#modules/entity-import/population-trigger-live";
import { ProviderEntityPopulationWorkflowDefinitionsLive } from "#modules/entity-import/provider-entity-population-workflow";
import { StreamRegistry } from "#modules/entity-interest/registry";
import { InterestReconciler } from "#modules/entity-interest/service";
import { EntitySchemaWorkflowDefinitionsLive } from "#modules/entity-schemas/default-saved-view-workflow-live";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EntitySchemasService } from "#modules/entity-schemas/service";
import { TranslateEntityWorkflowDefinitionsLive } from "#modules/entity-translation/entity-translation-workflow-live";
import { TranslateEntityWorkflowOperationsLive } from "#modules/entity-translation/operations-workflow";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { TranslationsService } from "#modules/entity-translation/service";
import { EpisodeResolverRepository } from "#modules/episode-resolver/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventSchemasService } from "#modules/event-schemas/service";
import {
	EventCreateWorkflowDefinitionsLive,
	EventCreateWorkflowOperationsLive,
} from "#modules/events/event-create-workflow-live";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { BuiltinEntityPreloaderLive } from "#modules/exercises/preload";
import { GodModeRepository } from "#modules/god-mode/repository";
import { GodModeService } from "#modules/god-mode/service";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow-live";
import { ProcessNormalizedMediaImportWorkflowDefinitionsLive } from "#modules/imports/media/normalized-import-workflow-live";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import { IntegrationReconciliationWorkflowDefinitionsLive } from "#modules/integrations/reconciliation-workflow";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { LibraryEntityImportWorkflowDefinitionsLive } from "#modules/library-membership/library-entity-import-workflow";
import { EnsureLibraryMembershipWorkerLive } from "#modules/library-membership/membership-worker";
import { LibraryEntityImportWorkflowOperationsLive } from "#modules/library-membership/operations-workflow";
import { LibraryImportService } from "#modules/library-membership/service";
import { MediaMonitoringRefreshWorkflowDefinitionsLive } from "#modules/media-monitoring/refresh-workflow";
import { MediaMonitoringRepository } from "#modules/media-monitoring/repository";
import { MediaMonitoringService } from "#modules/media-monitoring/service";
import { MediaTrendingWorkflowOperationsLive } from "#modules/media-trending/operations-workflow";
import { MediaTrendingRefreshWorkflowDefinitionsLive } from "#modules/media-trending/refresh-workflow";
import { MediaTrendingRepository } from "#modules/media-trending/repository";
import { MetadataLookupService } from "#modules/metadata-lookup/service";
import { NotificationDeliveryService } from "#modules/notifications/delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "#modules/notifications/notification-delivery-workflow-live";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipSchemasService } from "#modules/relationship-schemas/service";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxCompiler } from "#modules/sandbox/compiler";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowDefinitionsLive } from "#modules/sandbox/sandbox-workflow-live";
import { SandboxApiService } from "#modules/sandbox/service";
import { DefaultSavedViewWorkerLive } from "#modules/saved-views/default-view-worker";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { SavedViewsService } from "#modules/saved-views/service";
import { FrequentCronSchedulerLive } from "#modules/scheduler/frequent-cron";
import { InfrequentCronSchedulerLive } from "#modules/scheduler/infrequent-cron";
import { SignalsRepository } from "#modules/signals/repository";
import {
	SignalEmissionService,
	SignalSchemasService,
	SignalsService,
} from "#modules/signals/service";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";
import { TestSupportService } from "#modules/test-support/service";
import { TrackersRepository } from "#modules/trackers/repository";
import { TrackersService } from "#modules/trackers/service";
import { UploadsService } from "#modules/uploads/service";
import { UserPreferencesService } from "#modules/user-preferences/service";
import { UserStateService } from "#modules/user-state/service";

import {
	FrequentCronWorkflowDefinitionsLive,
	InfrequentCronWorkflowDefinitionsLive,
} from "./cron-workflow-definitions";
import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.Default, BunContext.layer);

const BaseInfrastructureServicesLive = Layer.mergeAll(
	DbService.Default,
	RedisService.Default,
	ServerRun.Default,
	S3Service.Default,
	FetchHttpClient.layer,
);

const BaseInfrastructureLive = Layer.provide(BaseInfrastructureServicesLive, ConfigLive);

const ContentRepositoriesLive = Layer.mergeAll(
	CollectionsRepository.Default,
	EntitiesRepository.Default,
	MediaTrendingRepository.Default,
	MediaMonitoringRepository.Default,
	EntitySchemasRepository.Default,
	EpisodeResolverRepository.Default,
	EventSchemasRepository.Default,
	EventsRepository.Default,
	RelationshipSchemasRepository.Default,
	RelationshipsRepository.Default,
	SignalsRepository.Default,
	SignalSchemasRepository.Default,
	TranslationsRepository.Default,
);

const PlatformRepositoriesLive = Layer.mergeAll(
	AutomationsRepository.Default,
	GodModeRepository.Default,
	ImportsRepository.Default,
	IntegrationsRepository.Default,
	NotificationsRepository.Default,
	SandboxRepository.Default,
	SavedViewsRepository.Default,
	TrackersRepository.Default,
);

const RepositoriesLive = Layer.mergeAll(ContentRepositoriesLive, PlatformRepositoriesLive);

const MigrationBootstrapRepositoriesLive = Layer.mergeAll(
	AutomationsRepository.Default,
	EntitiesRepository.Default,
	EntitySchemasRepository.Default,
	SavedViewsRepository.Default,
	RelationshipSchemasRepository.Default,
	SignalSchemasRepository.Default,
	TrackersRepository.Default,
);

const CoreInfrastructureDependenciesLive = Layer.mergeAll(BaseInfrastructureLive, ConfigLive);

const CoreInfrastructureServicesLive = Layer.mergeAll(
	PersistedQueueLive,
	WorkflowEngineLive,
	DbRunnerLive,
	RepositoriesLive,
	TransactionRunnerLive,
);

const CoreInfrastructureLive = Layer.provide(
	CoreInfrastructureServicesLive,
	CoreInfrastructureDependenciesLive,
);

const ApplicationInfrastructureLive = Layer.mergeAll(
	CoreInfrastructureLive,
	CoreInfrastructureDependenciesLive,
);

const QueryEngineServiceLive = QueryEngineService.Default;
const NotificationSubscriptionsServiceLive = Layer.provide(
	NotificationSubscriptionsService.Default,
	AutomationsService.Default,
);

const LifecycleDispatchLayerLive = Layer.provide(LifecycleDispatchLive, AutomationsService.Default);
const EntitiesServiceLive = Layer.provide(
	EntitiesService.Default,
	Layer.mergeAll(QueryEngineServiceLive, LifecycleDispatchLayerLive),
);
const SavedViewsServiceLive = Layer.provide(SavedViewsService.Default, QueryEngineServiceLive);
const EntitySchemasServiceLive = Layer.provide(
	EntitySchemasService.Default,
	TrackersService.Default,
);
const BootstrapServicesLive = Layer.mergeAll(
	EntitiesServiceLive,
	SavedViewsServiceLive,
	TrackersService.Default,
	NotificationSubscriptionsServiceLive,
);
const AuthAndBootstrapServicesLive = Layer.provideMerge(AuthService.Default, BootstrapServicesLive);
const AuthDependentServicesLive = Layer.provideMerge(
	Layer.mergeAll(UserPreferencesService.Default, GodModeService.Default),
	AuthAndBootstrapServicesLive,
);

const InterestReconcilerLive = Layer.provide(
	InterestReconciler.Default,
	Layer.mergeAll(QueryEngineServiceLive, EntityPopulationTriggerLive, TranslationsService.Default),
);

const InterestServicesLive = Layer.mergeAll(StreamRegistry.Default, InterestReconcilerLive);
const EventsServiceLive = Layer.provide(EventsService.Default, QueryEngineServiceLive);
const SignalDispatchLayerLive = Layer.provide(SignalDispatchLive, AutomationsService.Default);
const SignalEmissionServiceLive = Layer.provide(
	SignalEmissionService.Default,
	SignalDispatchLayerLive,
);

const RuntimeSandboxServiceLive = Layer.provide(
	SandboxService.Default,
	Layer.mergeAll(
		EventsServiceLive,
		QueryEngineServiceLive,
		SignalEmissionServiceLive,
		NotificationsService.Default,
	),
);

const SandboxApiServiceLive = Layer.provide(SandboxApiService.Default, SandboxCompiler.Default);
const SandboxServicesLive = Layer.mergeAll(SandboxApiServiceLive, RuntimeSandboxServiceLive);

const ContentServicesLive = Layer.mergeAll(
	AuthDependentServicesLive,
	EntitySchemasServiceLive,
	LibraryImportService.Default,
	EpisodeResolverService.Default,
	EventSchemasService.Default,
	EventsServiceLive,
	QueryEngineServiceLive,
	RelationshipSchemasService.Default,
	AutomationsService.Default,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasService.Default,
	SignalsService.Default,
	TranslationsService.Default,
);

const UserStateServiceLive = Layer.provide(
	UserStateService.Default,
	Layer.mergeAll(EventsServiceLive, RelationshipsService.Default),
);

const ImportsServiceLive = Layer.provideMerge(
	ImportsService.Default,
	Layer.mergeAll(UploadsService.Default, ImportRunFailuresService.Default),
);

const PlatformServicesLive = Layer.mergeAll(
	RelationshipsService.Default,
	UserStateServiceLive,
	ImportsServiceLive,
	Layer.provide(IntegrationsService.Default, ImportsServiceLive),
	NotificationsService.Default,
	NotificationDeliveryService.Default,
);

const ServicesNeedingCollectionsScopeLive = Layer.mergeAll(
	ContentServicesLive,
	PlatformServicesLive,
);

const CollectionsServiceLive = Layer.provide(
	CollectionsService.Default,
	Layer.mergeAll(EntitiesServiceLive, EventsServiceLive, RelationshipsService.Default),
);

const ServicesBaseLive = Layer.provideMerge(
	ServicesNeedingCollectionsScopeLive,
	CollectionsServiceLive,
);

const MediaMonitoringRelationshipsServiceLive = Layer.provide(
	RelationshipsService.Default,
	RelationshipsRepository.Default,
);

const MediaMonitoringCollectionsServiceLive = Layer.provideMerge(
	CollectionsServiceLive,
	Layer.mergeAll(RelationshipSchemasRepository.Default, RelationshipsRepository.Default),
);

const MediaMonitoringServiceDependenciesLive = Layer.mergeAll(
	MediaMonitoringCollectionsServiceLive,
	QueryEngineServiceLive,
	MediaMonitoringRepository.Default,
	MediaMonitoringRelationshipsServiceLive,
);

const MediaMonitoringServiceLive = Layer.provide(
	MediaMonitoringService.Default,
	MediaMonitoringServiceDependenciesLive,
);

const MetadataLookupServiceLive = Layer.provide(
	MetadataLookupService.Default,
	RuntimeSandboxServiceLive,
);

const ServicesLive = Layer.mergeAll(
	Layer.provideMerge(ServicesBaseLive, SandboxServicesLive),
	MetadataLookupServiceLive,
	MediaMonitoringServiceLive,
	InterestServicesLive,
	LifecycleDispatchLayerLive,
);

const ServicesWithTestSupportLive = Layer.provideMerge(TestSupportService.Default, ServicesLive);

const ServiceDependenciesLive = Layer.provide(
	ServicesWithTestSupportLive,
	ApplicationInfrastructureLive,
);
const RuntimeLive = (builtinExercisePreloadLimit: number) =>
	Layer.mergeAll(
		AddEntityToCollectionWorkflowDefinitionsLive,
		SubscriptionExecutionWorkflowDefinitionsLive,
		ProviderEntityPopulationWorkflowDefinitionsLive,
		EntitySchemaWorkflowDefinitionsLive,
		EventCreateWorkflowDefinitionsLive,
		LibraryEntityImportWorkflowDefinitionsLive,
		NotificationDeliveryWorkflowDefinitionsLive,
		MediaMonitoringRefreshWorkflowDefinitionsLive,
		MediaTrendingRefreshWorkflowDefinitionsLive,
		IntegrationReconciliationWorkflowDefinitionsLive,
		EnsureLibraryMembershipWorkerLive,
		DefaultSavedViewWorkerLive,
		BuiltinEntityPreloaderLive(builtinExercisePreloadLimit),
		ImportWorkflowDefinitionsLive,
		ProcessNormalizedMediaImportWorkflowDefinitionsLive,
		IntegrationWorkflowDefinitionsLive,
		SandboxWorkflowDefinitionsLive,
		TranslateEntityWorkflowDefinitionsLive,
		ServerLive,
		FrequentCronWorkflowDefinitionsLive,
		InfrequentCronWorkflowDefinitionsLive,
		FrequentCronSchedulerLive,
		InfrequentCronSchedulerLive,
	);

const SeedServiceLive = Layer.provide(
	SeedService.Default,
	Layer.mergeAll(AutomationsService.Default, SignalSchemasService.Default),
);

const MigrationBootstrapServicesLive = Layer.provideMerge(
	Layer.mergeAll(
		Layer.provideMerge(NotificationSubscriptionsService.Default, AutomationsService.Default),
		EntitiesService.Default,
		SavedViewsService.Default,
		SignalSchemasService.Default,
		TrackersService.Default,
	),
	Layer.mergeAll(LifecycleDispatchNoop, QueryEngineServiceLive, MigrationBootstrapRepositoriesLive),
);

const RuntimeAfterMigrationsLive = (builtinExercisePreloadLimit: number) =>
	MigrationsComplete.Default.pipe(
		Layer.flatMap(() =>
			SeedServiceLive.pipe(
				Layer.flatMap(() =>
					LegacyBootstrapMigrateDrop.Default.pipe(
						Layer.flatMap(() => RuntimeLive(builtinExercisePreloadLimit)),
					),
				),
			),
		),
	);

const RuntimeDependenciesLive = Layer.mergeAll(
	ServiceDependenciesLive,
	ApplicationInfrastructureLive,
	Layer.provide(EntityImportWorkflowOperationsLive, ApplicationInfrastructureLive),
	Layer.provide(EventCreateWorkflowOperationsLive, ApplicationInfrastructureLive),
	SubscriptionExecutionWorkflowOperationsLive,
	Layer.provide(LibraryEntityImportWorkflowOperationsLive, ApplicationInfrastructureLive),
	Layer.provide(TranslateEntityWorkflowOperationsLive, ApplicationInfrastructureLive),
	Layer.provide(MediaTrendingWorkflowOperationsLive, ApplicationInfrastructureLive),
);

const MigrationOnlyCoreLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() =>
		SeedServiceLive.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.Default)),
	),
	Layer.provide(MigrationBootstrapServicesLive),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbService.Default),
	Layer.provide(ConfigLive),
);

export const SandboxCacheOnlyLive = PackageCacheManager.Default.pipe(
	Layer.provide(BunContext.layer),
);

const AppCoreLive = (builtinExercisePreloadLimit: number) =>
	Layer.provide(RuntimeAfterMigrationsLive(builtinExercisePreloadLimit), RuntimeDependenciesLive);
const ObservabilityProvided = Layer.provide(ObservabilityLive, ConfigLive);

export const AppLive = (builtinExercisePreloadLimit: number) =>
	Layer.provide(AppCoreLive(builtinExercisePreloadLimit), ObservabilityProvided);
export const MigrationOnlyLive = Layer.provide(MigrationOnlyCoreLive, ObservabilityProvided);
