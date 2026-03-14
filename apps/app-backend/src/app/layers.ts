import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { AppConfig } from "#lib/infrastructure/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "#lib/infrastructure/db/migrate";
import { DbService, DbRunnerLive, TransactionRunnerLive } from "#lib/infrastructure/db/service";
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
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/integration-workflow-live";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import { IntegrationReconciliationWorkflowDefinitionsLive } from "#modules/integrations/reconciliation-workflow";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { NotificationDeliveryService } from "#modules/notifications/delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "#modules/notifications/notification-delivery-workflow-live";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { FirstPartyPluginBootstrap } from "#modules/plugins/boot";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { OperationsService } from "#modules/plugins/operations-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/sandbox-plugin-script-resolver-live";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";
import { PluginIngestionService, PluginInvalidationSubscriber } from "#modules/plugins/service";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
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
import { UploadsService } from "#modules/uploads/service";
import { AuthUserBootstrapLive } from "#modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";
import { UserPreferencesService } from "#modules/user-preferences/service";
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
		DbService.layer,
		RedisService.layer,
		LocalStorageService.layer,
		ServerRun.layer,
		S3Service.layer,
		FetchHttpClient.layer,
	),
);

const BaseInfrastructureLive = Layer.provide(BaseInfrastructureServicesLive, ConfigLive);

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
	AutomationsRepository.layer,
	GodModeRepository.layer,
	ImportsRepository.layer,
	IntegrationsRepository.layer,
	NotificationsRepository.layer,
	SandboxRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
	SavedViewsRepository.layer,
	DefinitionsRepository.layer,
	PluginRepository.layer,
);

const definitionRegistry = makeDefinitionRegistry();
const pluginLoader = makePluginLoader(definitionRegistry);
const PluginLoaderLive = Layer.mergeAll(
	Layer.succeed(DefinitionRegistry, definitionRegistry),
	Layer.succeed(PluginLoader, pluginLoader),
);
const PluginRuntimeResolverLive = PluginRuntimeResolver.layer.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
const SandboxPluginScriptResolverLive = Layer.provideMerge(
	PluginSandboxScriptResolverLive,
	PluginRuntimeResolverLive,
);
const ImportSourceCatalogLive = Layer.provide(ImportSourceCatalog.layer, PluginLoaderLive);
const IntegrationProviderCatalogLive = Layer.provide(
	IntegrationProviderCatalog.layer,
	PluginLoaderLive,
);
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

const QueryEngineServiceLive = QueryEngineService.layer;
const NotificationSubscriptionsServiceLive = Layer.provide(
	NotificationSubscriptionsService.layer,
	AutomationsService.layer,
);

const LifecycleDispatchLayerLive = Layer.provide(LifecycleDispatchLive, AutomationsService.layer);

const EntitiesServiceLive = Layer.provide(
	EntitiesService.layer,
	Layer.mergeAll(QueryEngineServiceLive, LifecycleDispatchLayerLive),
);

const SavedViewsServiceLive = Layer.provide(SavedViewsService.layer, QueryEngineServiceLive);

const DefinitionsServiceLive = DefinitionsService.layer;

const BootstrapServicesLive = Layer.mergeAll(
	EntitiesServiceLive,
	NotificationSubscriptionsServiceLive,
	SavedViewsServiceLive,
);

const AuthUserBootstrapProvidedLive = Layer.provideMerge(
	AuthUserBootstrapLive,
	BootstrapServicesLive,
);

const AuthAndBootstrapServicesLive = Layer.mergeAll(
	BootstrapServicesLive,
	Layer.provide(AuthService.layer, AuthUserBootstrapProvidedLive),
);
const AuthDependentServicesLive = Layer.provideMerge(
	Layer.mergeAll(UserPreferencesService.layer, GodModeService.layer),
	AuthAndBootstrapServicesLive,
);

const InterestReconcilerLive = Layer.provide(
	InterestReconciler.layer,
	Layer.mergeAll(QueryEngineServiceLive, EntityPopulationTriggerLive, TranslationsService.layer),
);

const InterestServicesLive = Layer.provideMerge(
	InterestService.layer,
	Layer.mergeAll(StreamRegistry.layer, InterestReconcilerLive),
);
const EventsServiceLive = Layer.provide(EventsService.layer, QueryEngineServiceLive);
const SignalDispatchLayerLive = Layer.provide(SignalDispatchLive, AutomationsService.layer);
const SignalEmissionServiceLive = Layer.provide(
	SignalEmissionService.layer,
	SignalDispatchLayerLive,
);

export const SandboxHostImplementationsLive = Layer.effect(
	SandboxHostImplementations,
	Effect.all({
		runtime: makeRuntimeSandboxApiFunctions,
		additional: makeAdditionalSandboxApiFunctions,
		automation: makeAutomationSandboxApiFunctions,
	}),
).pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsServiceLive,
			QueryEngineServiceLive,
			SignalEmissionServiceLive,
			NotificationsService.layer,
		),
	),
);

export const RuntimeSandboxServiceLive = Layer.provide(
	SandboxService.layer,
	SandboxHostImplementationsLive,
);

const SandboxExecutionServiceLive = Layer.provide(
	SandboxExecutionService.layer,
	SandboxPluginScriptResolverLive,
);

const PluginUserBootstrapDispatcherDependenciesLive = Layer.provideMerge(
	SandboxExecutionServiceLive,
	PluginRuntimeResolverLive,
);

const PluginUserBootstrapDispatcherLive = Layer.provide(
	PluginUserBootstrapDispatcher.layer,
	PluginUserBootstrapDispatcherDependenciesLive,
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
	DefinitionsServiceLive,
	QueryEngineServiceLive,
	AutomationsService.layer,
	NotificationSubscriptionsServiceLive,
	SignalEmissionServiceLive,
	SignalSchemasService.layer,
	SignalsService.layer,
	TranslationsService.layer,
);

const UserStateServiceLive = UserStateService.layer.pipe(
	Layer.provide(Layer.mergeAll(EventsServiceLive, RelationshipsService.layer)),
	Layer.provide(PluginLoaderLive),
);

const ImportsServiceLive = Layer.provideMerge(
	ImportsService.layer,
	Layer.mergeAll(
		UploadsService.layer,
		ImportSourceCatalogLive,
		ImportRunFailuresService.layer,
		ImportWorkflowPinningLive,
	),
);

const PlatformServicesLive = Layer.mergeAll(
	RelationshipsService.layer,
	UserStateServiceLive,
	ImportsServiceLive,
	Layer.provide(
		IntegrationsService.layer,
		Layer.mergeAll(ImportsServiceLive, IntegrationProviderCatalogLive),
	),
	NotificationsService.layer,
	NotificationDeliveryService.layer,
);

const ServicesNeedingCollectionsScopeLive = Layer.mergeAll(
	ContentServicesLive,
	PlatformServicesLive,
);

const CollectionsServiceLive = Layer.provide(
	CollectionsService.layer,
	Layer.mergeAll(EntitiesServiceLive, EventsServiceLive, RelationshipsService.layer),
);

const ServicesBaseLive = Layer.provideMerge(
	ServicesNeedingCollectionsScopeLive,
	CollectionsServiceLive,
);

const ContentAndSandboxServicesLive = Layer.provideMerge(ServicesBaseLive, SandboxServicesLive);

const OperationsServiceLive = Layer.provide(
	OperationsService.layer,
	Layer.mergeAll(ContentAndSandboxServicesLive, IntegrationOperationScopeResolverLive),
);

const ServicesLive = Layer.mergeAll(
	ContentAndSandboxServicesLive,
	PluginIngestionServiceLive,
	OperationsServiceLive,
	InterestServicesLive,
	LifecycleDispatchLayerLive,
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

const FirstPartyPluginBootstrapLive = Layer.provide(
	FirstPartyPluginBootstrap.layer,
	Layer.mergeAll(PluginIngestionServiceLive, PluginRepository.layer, ScriptGarbageCollectorLive),
);

const MigrationBootstrapDependenciesLive = Layer.provideMerge(
	Layer.mergeAll(LifecycleDispatchNoop, QueryEngineServiceLive, MigrationBootstrapRepositoriesLive),
	PluginRuntimeResolverLive,
);
const MigrationBootstrapServicesLive = Layer.provide(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.provideMerge(NotificationSubscriptionsService.layer, AutomationsService.layer),
			SavedViewsServiceLive,
			Layer.fresh(EntitiesService.layer),
			SignalSchemasService.layer,
		),
		PluginLoaderLive,
	),
	MigrationBootstrapDependenciesLive,
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
	),
	ApplicationInfrastructureLive,
);

export const RuntimeAfterMigrationsLive = MigrationsComplete.layer.pipe(
	Layer.flatMap(() =>
		FirstPartyPluginBootstrapLive.pipe(
			Layer.flatMap(() =>
				LegacyBootstrapMigrateDrop.layer.pipe(
					Layer.flatMap(() =>
						Layer.provide(
							Layer.provideMerge(
								RuntimeLive,
								Layer.provide(PluginInvalidationSubscriber.layer, PluginIngestionServiceLive),
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
	Layer.provide(DbService.layer),
	Layer.provide(RedisService.layer),
	Layer.provide(ConfigLive),
);

const MigrationOnlyCoreLive = MigrationsComplete.layer.pipe(
	Layer.flatMap(() =>
		FirstPartyPluginBootstrapLive.pipe(Layer.flatMap(() => LegacyBootstrapMigrateDrop.layer)),
	),
	Layer.provide(MigrationBootstrapServicesLive),
	Layer.provide(DbRunnerLive),
	Layer.provide(TransactionRunnerLive),
	Layer.provide(DbService.layer),
	Layer.provide(RedisService.layer),
	Layer.provide(ConfigLive),
);

const AppCoreLive = RuntimeAfterMigrationsLive;
const ObservabilityProvided = Layer.provide(ObservabilityLive, ConfigLive);

export const AppLive = Layer.provide(AppCoreLive, ObservabilityProvided);
export const MigrationOnlyLive = Layer.provide(MigrationOnlyCoreLive, ObservabilityProvided);
