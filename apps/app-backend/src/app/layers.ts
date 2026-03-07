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
import { IntegrationProviderCatalogLive } from "#modules/plugins/integration-provider-catalog";
import { PluginLoaderLive } from "#modules/plugins/loader";
import { OperationsService } from "#modules/plugins/operations-service";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/sandbox-plugin-script-resolver-live";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";
import { PluginIngestionService, PluginInvalidationSubscriber } from "#modules/plugins/service";
import { QueryEngineService } from "#modules/query-engine/service";
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
	DbRunnerLive,
	RepositoriesLive,
	TransactionRunnerLive,
);

const ApplicationInfrastructureLive = CoreInfrastructureServicesLive.pipe(
	Layer.provideMerge(CoreInfrastructureDependenciesLive),
);

const QueryEngineServiceLive = QueryEngineService.layer;
const RyotQLServiceLive = RyotQLService.layer;
const NotificationSubscriptionsServiceLive = NotificationSubscriptionsService.layer.pipe(
	Layer.provide(AutomationsService.layer),
);

const LifecycleDispatchServiceLive = LifecycleDispatchLive.pipe(
	Layer.provide(AutomationsService.layer),
);

const EntitiesServiceLive = EntitiesService.layer.pipe(
	Layer.provide([RyotQLServiceLive, LifecycleDispatchServiceLive]),
);

const SavedViewsServiceLive = SavedViewsService.layer.pipe(Layer.provide(QueryEngineServiceLive));

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
	AuthService.layer.pipe(Layer.provide(AuthUserBootstrapProvidedLive)),
);
const AuthDependentServicesLive = Layer.mergeAll(
	UserPreferencesService.layer,
	GodModeService.layer,
).pipe(Layer.provideMerge(AuthAndBootstrapServicesLive));

const InterestReconcilerLive = InterestReconciler.layer.pipe(
	Layer.provide([RyotQLServiceLive, EntityPopulationTriggerLive, TranslationsService.layer]),
);

const InterestServicesLive = InterestService.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(StreamRegistry.layer, InterestReconcilerLive)),
);
const EventsServiceLive = EventsService.layer.pipe(Layer.provide(QueryEngineServiceLive));
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
		QueryEngineServiceLive,
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
	QueryEngineServiceLive,
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
			UploadsService.layer,
			ImportSourceCatalogLive,
			ImportRunFailuresService.layer,
			ImportWorkflowPinningLive,
		),
	),
);

const PlatformServicesLive = Layer.mergeAll(
	RelationshipsService.layer,
	UserStateServiceLive,
	ImportsServiceLive,
	IntegrationsService.layer.pipe(
		Layer.provide([ImportsServiceLive, IntegrationProviderCatalogLive]),
	),
	NotificationsService.layer,
	NotificationDeliveryService.layer,
);

const CollectionsServiceLive = CollectionsService.layer.pipe(
	Layer.provide([EntitiesServiceLive, EventsServiceLive, RelationshipsService.layer]),
);

const ServicesBaseLive = Layer.mergeAll(ContentServicesLive, PlatformServicesLive).pipe(
	Layer.provideMerge(CollectionsServiceLive),
);

const ContentAndSandboxServicesLive = ServicesBaseLive.pipe(
	Layer.provideMerge(SandboxServicesLive),
);

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
	QueryEngineServiceLive,
	RyotQLServiceLive,
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

const MigrationDatabaseServicesLive = Layer.mergeAll(DbRunnerLive, TransactionRunnerLive).pipe(
	Layer.provideMerge(DbService.layer),
);

const MigrationInfrastructureLive = MigrationBootstrapServicesLive.pipe(
	Layer.provideMerge(MigrationDatabaseServicesLive),
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
