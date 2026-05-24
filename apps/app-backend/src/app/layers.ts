import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { AuthService } from "~/lib/auth";
import { SeedService } from "~/lib/builtins/seed";
import { AppConfig } from "~/lib/config";
import { DbService, DbRunnerLive, TransactionRunnerLive } from "~/lib/db";
import { MigrationsComplete } from "~/lib/db/migrate";
import { RedisService } from "~/lib/redis";
import { S3Service } from "~/lib/s3";
import { SandboxService } from "~/lib/sandbox";
import { PersistedQueueLive, WorkflowEngineLive } from "~/lib/workflow";
import { CollectionsRepository } from "~/modules/collections/repository";
import { CollectionsService } from "~/modules/collections/service";
import { EntitiesRepository } from "~/modules/entities/repository";
import { EntitiesService } from "~/modules/entities/service";
import { EntityImportWorkflowDefinitionsLive } from "~/modules/entities/workflows";
import { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import { EntitySchemasService } from "~/modules/entity-schemas/service";
import { EventSchemasRepository } from "~/modules/event-schemas/repository";
import { EventSchemasService } from "~/modules/event-schemas/service";
import { EventsRepository } from "~/modules/events/repository";
import { EventsService } from "~/modules/events/service";
import { GodModeService } from "~/modules/god-mode/service";
import { ImportsRepository } from "~/modules/imports/repository";
import { ImportsService } from "~/modules/imports/service";
import { ImportWorkflowDefinitionsLive } from "~/modules/imports/worker";
import { IntegrationsRepository } from "~/modules/integrations/repository";
import { IntegrationsSchedulerLive } from "~/modules/integrations/scheduler";
import { IntegrationsService } from "~/modules/integrations/service";
import { IntegrationWorkflowDefinitionsLive } from "~/modules/integrations/worker";
import { QueryEngineService } from "~/modules/query-engine/service";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";
import { RelationshipSchemasService } from "~/modules/relationship-schemas/service";
import { SandboxRepository } from "~/modules/sandbox/repository";
import { SandboxApiService } from "~/modules/sandbox/service";
import { SandboxWorkflowDefinitionsLive } from "~/modules/sandbox/workflows";
import { SavedViewsRepository } from "~/modules/saved-views/repository";
import { SavedViewsService } from "~/modules/saved-views/service";
import { TrackersRepository } from "~/modules/trackers/repository";
import { TrackersService } from "~/modules/trackers/service";
import { UploadsService } from "~/modules/uploads/service";

import { ServerLive } from "./server";

const ConfigLive = Layer.mergeAll(AppConfig.Default, BunContext.layer);

const BaseInfrastructureServicesLive = Layer.mergeAll(
	DbService.Default,
	RedisService.Default,
	S3Service.Default,
	FetchHttpClient.layer,
);

const BaseInfrastructureLive = Layer.provide(BaseInfrastructureServicesLive, ConfigLive);

const RepositoriesLive = Layer.mergeAll(
	CollectionsRepository.Default,
	EntitiesRepository.Default,
	EntitySchemasRepository.Default,
	EventSchemasRepository.Default,
	EventsRepository.Default,
	ImportsRepository.Default,
	IntegrationsRepository.Default,
	RelationshipSchemasRepository.Default,
	SandboxRepository.Default,
	SavedViewsRepository.Default,
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

const SandboxServicesLive = Layer.mergeAll(SandboxApiService.Default, SandboxService.Default);

const ServicesBaseLive = Layer.mergeAll(
	AuthService.Default,
	CollectionsService.Default,
	EntitiesService.Default,
	EntitySchemasService.Default,
	EventSchemasService.Default,
	EventsService.Default,
	Layer.provide(GodModeService.Default, AuthService.Default),
	Layer.provide(ImportsService.Default, UploadsService.Default),
	IntegrationsService.Default,
	QueryEngineService.Default,
	RelationshipSchemasService.Default,
	SavedViewsService.Default,
	TrackersService.Default,
	UploadsService.Default,
);

const ServicesLive = Layer.provideMerge(ServicesBaseLive, SandboxServicesLive);

const ServiceDependenciesLive = Layer.provide(ServicesLive, ApplicationInfrastructureLive);

const RuntimeLive = Layer.mergeAll(
	EntityImportWorkflowDefinitionsLive,
	ImportWorkflowDefinitionsLive,
	IntegrationWorkflowDefinitionsLive,
	SandboxWorkflowDefinitionsLive,
	ServerLive,
	IntegrationsSchedulerLive,
);

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() => SeedService.Default.pipe(Layer.flatMap(() => RuntimeLive))),
);

const RuntimeDependenciesLive = Layer.mergeAll(
	ServiceDependenciesLive,
	ApplicationInfrastructureLive,
);

export const AppLive = Layer.provide(RuntimeAfterMigrationsLive, RuntimeDependenciesLive);
