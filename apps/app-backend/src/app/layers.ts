import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthService } from "#lib/auth";
import { SeedService } from "#lib/builtins/seed";
import { AppConfig } from "#lib/config/service";
import { LegacyBootstrapMigrateDrop, MigrationsComplete } from "#lib/db/migrate";
import { DbService, DbRunnerLive, TransactionRunnerLive } from "#lib/db/service";
import { RedisService } from "#lib/redis";
import { S3Service } from "#lib/s3";
import { SandboxService } from "#lib/sandbox/service";
import { PersistedQueueLive, WorkflowEngineLive } from "#lib/workflow";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityPopulationTriggerLive } from "#modules/entity-import/population-trigger-live";
import {
	BuiltinEntityImportWorkflowDefinitionsLive,
	EntityImportWorkflowOperationsLive,
} from "#modules/entity-import/workflows";
import { StreamRegistry } from "#modules/entity-interest/registry";
import { InterestReconciler } from "#modules/entity-interest/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EntitySchemasService } from "#modules/entity-schemas/service";
import { EntitySchemaWorkflowDefinitionsLive } from "#modules/entity-schemas/workflows";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { TranslationsService } from "#modules/entity-translation/service";
import { TranslateEntityWorkflowDefinitionsLive } from "#modules/entity-translation/workflows";
import { EpisodeResolverRepository } from "#modules/episode-resolver/repository";
import { EpisodeResolverService } from "#modules/episode-resolver/service";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventSchemasService } from "#modules/event-schemas/service";
import { EventCreateWorkflowDefinitionsLive } from "#modules/events/event-create-workflow-live";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { BuiltinEntityPreloaderLive } from "#modules/exercises/preload";
import { GodModeRepository } from "#modules/god-mode/repository";
import { GodModeService } from "#modules/god-mode/service";
import { ImportWorkflowDefinitionsLive } from "#modules/imports/import-run-workflow";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsSchedulerLive } from "#modules/integrations/scheduler";
import { IntegrationsService } from "#modules/integrations/service";
import { IntegrationWorkflowDefinitionsLive } from "#modules/integrations/workflows";
import { GlobalEntityReferencedWorkerLive } from "#modules/library-membership/global-reference-worker";
import { LibraryImportService } from "#modules/library-membership/service";
import { LibraryEntityImportWorkflowDefinitionsLive } from "#modules/library-membership/workflows";
import { ProviderConfig } from "#modules/query-engine/provider-config";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipSchemasService } from "#modules/relationship-schemas/service";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxApiService } from "#modules/sandbox/service";
import { SandboxWorkflowDefinitionsLive } from "#modules/sandbox/workflows";
import { DefaultSavedViewWorkerLive } from "#modules/saved-views/default-view-worker";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { SavedViewsService } from "#modules/saved-views/service";
import { TrackersRepository } from "#modules/trackers/repository";
import { TrackersService } from "#modules/trackers/service";
import { UploadsService } from "#modules/uploads/service";
import { UserPreferencesService } from "#modules/user-preferences/service";
import { UserStateService } from "#modules/user-state/service";

import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.Default, BunContext.layer);

const BaseInfrastructureServicesLive = Layer.mergeAll(
	DbService.Default,
	RedisService.Default,
	S3Service.Default,
	FetchHttpClient.layer,
);

const BaseInfrastructureLive = Layer.provide(BaseInfrastructureServicesLive, ConfigLive);

const ContentRepositoriesLive = Layer.mergeAll(
	CollectionsRepository.Default,
	EntitiesRepository.Default,
	EntitySchemasRepository.Default,
	EpisodeResolverRepository.Default,
	EventSchemasRepository.Default,
	EventsRepository.Default,
	RelationshipSchemasRepository.Default,
	RelationshipsRepository.Default,
	TranslationsRepository.Default,
);

const PlatformRepositoriesLive = Layer.mergeAll(
	GodModeRepository.Default,
	ImportsRepository.Default,
	IntegrationsRepository.Default,
	SandboxRepository.Default,
	SavedViewsRepository.Default,
	TrackersRepository.Default,
);

const RepositoriesLive = Layer.mergeAll(ContentRepositoriesLive, PlatformRepositoriesLive);

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

// The query engine reads canonical languages from ProviderConfig for its `translationStatus` field.
const QueryEngineServiceLive = Layer.provide(QueryEngineService.Default, ProviderConfig.Default);

const EntitiesServiceLive = Layer.provide(EntitiesService.Default, QueryEngineServiceLive);

const InterestReconcilerLive = Layer.provide(
	InterestReconciler.Default,
	Layer.mergeAll(QueryEngineServiceLive, EntityPopulationTriggerLive, TranslationsService.Default),
);

const InterestServicesLive = Layer.mergeAll(StreamRegistry.Default, InterestReconcilerLive);
const EventsServiceLive = Layer.provide(EventsService.Default, QueryEngineServiceLive);

const RuntimeSandboxServiceLive = Layer.provide(
	SandboxService.Default,
	Layer.mergeAll(EventsServiceLive, QueryEngineServiceLive),
);

const SandboxServicesLive = Layer.mergeAll(SandboxApiService.Default, RuntimeSandboxServiceLive);

const ContentServicesLive = Layer.mergeAll(
	AuthService.Default,
	EntitiesServiceLive,
	LibraryImportService.Default,
	EntitySchemasService.Default,
	EpisodeResolverService.Default,
	EventSchemasService.Default,
	EventsServiceLive,
	QueryEngineServiceLive,
	RelationshipSchemasService.Default,
);

const PlatformServicesLive = Layer.mergeAll(
	RelationshipsService.Default,
	Layer.provide(SavedViewsService.Default, QueryEngineServiceLive),
	TrackersService.Default,
	UploadsService.Default,
	Layer.provide(UserPreferencesService.Default, AuthService.Default),
	UserStateService.Default,
	Layer.provide(GodModeService.Default, AuthService.Default),
	Layer.provide(ImportsService.Default, UploadsService.Default),
	Layer.provide(
		IntegrationsService.Default,
		Layer.provide(ImportsService.Default, UploadsService.Default),
	),
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

const ServicesLive = Layer.mergeAll(
	Layer.provideMerge(ServicesBaseLive, SandboxServicesLive),
	InterestServicesLive,
);

const ServiceDependenciesLive = Layer.provide(ServicesLive, ApplicationInfrastructureLive);

const RuntimeLive = Layer.mergeAll(
	BuiltinEntityImportWorkflowDefinitionsLive,
	EntitySchemaWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsLive,
	LibraryEntityImportWorkflowDefinitionsLive,
	GlobalEntityReferencedWorkerLive,
	DefaultSavedViewWorkerLive,
	BuiltinEntityPreloaderLive,
	ImportWorkflowDefinitionsLive,
	IntegrationWorkflowDefinitionsLive,
	SandboxWorkflowDefinitionsLive,
	TranslateEntityWorkflowDefinitionsLive,
	ServerLive,
	IntegrationsSchedulerLive,
);

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() =>
		SeedService.Default.pipe(
			Layer.flatMap(() =>
				LegacyBootstrapMigrateDrop.Default.pipe(Layer.flatMap(() => RuntimeLive)),
			),
		),
	),
);

const RuntimeDependenciesLive = Layer.mergeAll(
	ServiceDependenciesLive,
	ApplicationInfrastructureLive,
	Layer.provide(EntityImportWorkflowOperationsLive, ApplicationInfrastructureLive),
);

export const AppLive = Layer.provide(RuntimeAfterMigrationsLive, RuntimeDependenciesLive);
