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
import {
	AddEntityToCollectionWorkflowDefinitionsLive,
	AddEntityToCollectionWorkflowOperationsLive,
} from "#modules/collections/add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { DefinitionsRepository } from "#modules/definitions/repository";
import { DefinitionsService } from "#modules/definitions/service";
import { LifecycleDispatchNoop } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityImportWorkflowDefinitionsLive } from "#modules/entity-import/entity-import-workflow";
import { EntityImportWorkflowOperationsLive } from "#modules/entity-import/operations-workflow";
import { EntityPopulationTriggerLive } from "#modules/entity-import/population-trigger-live";
import { ProviderEntityPopulationWorkflowDefinitionsLive } from "#modules/entity-import/provider-entity-population-workflow";
import { EntityImportService } from "#modules/entity-import/service";
import { StreamRegistry } from "#modules/entity-interest/registry";
import { InterestReconciler, InterestService } from "#modules/entity-interest/service";
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
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import { IntegrationReconciliationWorkflowDefinitionsLive } from "#modules/integrations/reconciliation-workflow";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { NotificationDeliveryService } from "#modules/notifications/delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "#modules/notifications/notification-delivery-workflow-live";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { FirstPartyPluginBootstrap } from "#modules/plugins/boot";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { OperationsService } from "#modules/plugins/operations-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { PluginIngestionService, PluginInvalidationSubscriber } from "#modules/plugins/service";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxWorkflowDefinitionsLive } from "#modules/sandbox/sandbox-workflow-live";
import { SandboxExecutionService } from "#modules/sandbox/service";
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
import { UploadsService } from "#modules/uploads/service";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";
import { UserPreferencesService } from "#modules/user-preferences/service";
import { UserStateService } from "#modules/user-state/service";

import { FrequentCronWorkflowDefinitionsLive } from "./cron-workflow-definitions";
import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";
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
	EntitySchemasRepository.Default,
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
	DefinitionsRepository.Default,
	PluginRepository.Default,
);

const definitionRegistry = makeDefinitionRegistry();
const pluginLoader = makePluginLoader(definitionRegistry);
const PluginLoaderLive = Layer.mergeAll(
	Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitionRegistry }),
	Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...pluginLoader }),
);
const PluginRuntimeResolverLive = PluginRuntimeResolver.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
const ImportSourceCatalogLive = Layer.provide(ImportSourceCatalog.Default, PluginLoaderLive);
const IntegrationProviderCatalogLive = Layer.provide(
	IntegrationProviderCatalog.Default,
	PluginLoaderLive,
);
const PluginIngestionServiceLive = Layer.provide(
	PluginIngestionService.Default,
	Layer.mergeAll(PluginLoaderLive, PluginRepository.Default),
);
const RepositoriesLive = Layer.provideMerge(
	Layer.mergeAll(ContentRepositoriesLive, PlatformRepositoriesLive),
	PluginRuntimeResolverLive,
);

const MigrationBootstrapRepositoriesLive = Layer.mergeAll(
	AutomationsRepository.Default,
	EntitiesRepository.Default,
	EntitySchemasRepository.Default,
	SavedViewsRepository.Default,
	RelationshipSchemasRepository.Default,
	SignalSchemasRepository.Default,
	DefinitionsRepository.Default,
	PluginRepository.Default,
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
const DefinitionsServiceLive = DefinitionsService.Default;
const BootstrapServicesLive = Layer.mergeAll(
	EntitiesServiceLive,
	NotificationSubscriptionsServiceLive,
);
const AuthAndBootstrapServicesLive = Layer.mergeAll(
	BootstrapServicesLive,
	Layer.provide(AuthService.Default, BootstrapServicesLive),
);
const AuthDependentServicesLive = Layer.provideMerge(
	Layer.mergeAll(UserPreferencesService.Default, GodModeService.Default),
	AuthAndBootstrapServicesLive,
);

const InterestReconcilerLive = Layer.provide(
	InterestReconciler.Default,
	Layer.mergeAll(QueryEngineServiceLive, EntityPopulationTriggerLive, TranslationsService.Default),
);

const InterestServicesLive = Layer.provideMerge(
	InterestService.Default,
	Layer.mergeAll(StreamRegistry.Default, InterestReconcilerLive),
);
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

const SandboxExecutionServiceLive = Layer.provide(
	SandboxExecutionService.Default,
	PluginRuntimeResolverLive,
);
const PluginUserBootstrapDispatcherDependenciesLive = Layer.provideMerge(
	Layer.mergeAll(RuntimeSandboxServiceLive, SandboxRepository.Default),
	PluginRuntimeResolverLive,
);
const PluginUserBootstrapDispatcherLive = Layer.provide(
	PluginUserBootstrapDispatcher.Default,
	PluginUserBootstrapDispatcherDependenciesLive,
);
const SandboxServicesLive = Layer.mergeAll(
	SandboxExecutionServiceLive,
	RuntimeSandboxServiceLive,
	PluginUserBootstrapDispatcherLive,
);

const ContentServicesLive = Layer.mergeAll(
	AuthDependentServicesLive,
	EntityImportService.Default,
	EventsServiceLive,
	SavedViewsServiceLive,
	DefinitionsServiceLive,
	QueryEngineServiceLive,
	AutomationsService.Default,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasService.Default,
	SignalsService.Default,
	TranslationsService.Default,
);

const UserStateServiceLive = UserStateService.Default.pipe(
	Layer.provide(Layer.mergeAll(EventsServiceLive, RelationshipsService.Default)),
	Layer.provide(PluginLoaderLive),
);

const ImportsServiceLive = Layer.provideMerge(
	ImportsService.Default,
	Layer.mergeAll(UploadsService.Default, ImportSourceCatalogLive, ImportRunFailuresService.Default),
);

const PlatformServicesLive = Layer.mergeAll(
	RelationshipsService.Default,
	UserStateServiceLive,
	ImportsServiceLive,
	Layer.provide(
		IntegrationsService.Default,
		Layer.mergeAll(ImportsServiceLive, IntegrationProviderCatalogLive),
	),
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

const ContentAndSandboxServicesLive = Layer.provideMerge(ServicesBaseLive, SandboxServicesLive);

const OperationsServiceLive = Layer.provide(
	OperationsService.Default,
	ContentAndSandboxServicesLive,
);

const ServicesLive = Layer.mergeAll(
	ContentAndSandboxServicesLive,
	PluginIngestionServiceLive,
	OperationsServiceLive,
	InterestServicesLive,
	LifecycleDispatchLayerLive,
	PluginBootService.Default,
	PluginCronService.Default,
);

const ServicesWithTestSupportLive = Layer.provideMerge(
	Layer.mergeAll(TestSupportService.Default, OperationalGateService.Default),
	ServicesLive,
);

const RuntimeLive = Layer.mergeAll(
	AddEntityToCollectionWorkflowDefinitionsLive,
	SubscriptionExecutionWorkflowDefinitionsLive,
	ProviderEntityPopulationWorkflowDefinitionsLive,
	EntityImportWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsLive,
	NotificationDeliveryWorkflowDefinitionsLive,
	IntegrationReconciliationWorkflowDefinitionsLive,
	ImportWorkflowDefinitionsLive,
	ProcessGenericImportChunksWorkflowDefinitionsLive,
	Layer.provide(IntegrationWorkflowDefinitionsLive, IntegrationProviderCatalogLive),
	Layer.provide(SandboxWorkflowDefinitionsLive, KernelWorkflowReferencesLive),
	TranslateEntityWorkflowDefinitionsLive,
	ServerLive,
	FrequentCronWorkflowDefinitionsLive,
	FrequentCronSchedulerLive,
	PluginBootDispatcherLive,
	PluginCronSchedulerLive,
);

const FirstPartyPluginBootstrapLive = Layer.provide(
	FirstPartyPluginBootstrap.Default,
	Layer.mergeAll(PluginIngestionServiceLive, PluginRepository.Default),
);

const MigrationBootstrapDependenciesLive = Layer.provideMerge(
	Layer.mergeAll(LifecycleDispatchNoop, QueryEngineServiceLive, MigrationBootstrapRepositoriesLive),
	PluginRuntimeResolverLive,
);
const MigrationBootstrapServicesLive = Layer.provide(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.provideMerge(NotificationSubscriptionsService.Default, AutomationsService.Default),
			Layer.fresh(EntitiesService.Default),
			SignalSchemasService.Default,
		),
		PluginLoaderLive,
	),
	MigrationBootstrapDependenciesLive,
);

const RuntimeDependenciesLive = Layer.provideMerge(
	Layer.mergeAll(
		Layer.provideMerge(
			Layer.mergeAll(
				AddEntityToCollectionWorkflowOperationsLive,
				EventCreateWorkflowOperationsLive,
			),
			ServicesWithTestSupportLive,
		),
		EntityImportWorkflowOperationsLive,
		SubscriptionExecutionWorkflowOperationsLive,
		TranslateEntityWorkflowOperationsLive,
	),
	ApplicationInfrastructureLive,
);

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() =>
		FirstPartyPluginBootstrapLive.pipe(
			Layer.flatMap(() =>
				LegacyBootstrapMigrateDrop.Default.pipe(
					Layer.flatMap(() =>
						Layer.provide(
							Layer.provideMerge(
								RuntimeLive,
								Layer.provide(PluginInvalidationSubscriber.Default, PluginIngestionServiceLive),
							),
							RuntimeDependenciesLive,
						),
					),
				),
			),
		),
	),
	Layer.provide(MigrationBootstrapServicesLive),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbService.Default),
	Layer.provide(RedisService.Default),
	Layer.provide(ConfigLive),
);

const MigrationOnlyCoreLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() =>
		FirstPartyPluginBootstrapLive.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.Default)),
	),
	Layer.provide(MigrationBootstrapServicesLive),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbService.Default),
	Layer.provide(RedisService.Default),
	Layer.provide(ConfigLive),
);

export const SandboxCacheOnlyLive = PackageCacheManager.Default.pipe(
	Layer.provide(BunContext.layer),
);

const AppCoreLive = RuntimeAfterMigrationsLive;
const ObservabilityProvided = Layer.provide(ObservabilityLive, ConfigLive);

export const AppLive = Layer.provide(AppCoreLive, ObservabilityProvided);
export const MigrationOnlyLive = Layer.provide(MigrationOnlyCoreLive, ObservabilityProvided);
