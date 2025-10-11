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
import { IntegrationsRepository } from "~/modules/integrations/repository";
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

const BaseInfrastructureLive = Layer.mergeAll(
	DbService.Default,
	RedisService.Default,
	S3Service.Default,
).pipe(Layer.provide(ConfigLive));

const RepositoriesLive = Layer.mergeAll(
	CollectionsRepository.Default,
	EntitiesRepository.Default,
	EntitySchemasRepository.Default,
	EventSchemasRepository.Default,
	EventsRepository.Default,
	IntegrationsRepository.Default,
	RelationshipSchemasRepository.Default,
	SandboxRepository.Default,
	SavedViewsRepository.Default,
	TrackersRepository.Default,
);

const CoreInfrastructureLive = Layer.mergeAll(
	PersistedQueueLive,
	WorkflowEngineLive,
	DbRunnerLive,
	RepositoriesLive,
	TransactionRunnerLive,
).pipe(Layer.provide(BaseInfrastructureLive), Layer.provide(ConfigLive));

const SandboxServicesLive = Layer.mergeAll(SandboxApiService.Default, SandboxService.Default);

const ServicesLive = Layer.mergeAll(
	AuthService.Default,
	CollectionsService.Default,
	EntitiesService.Default,
	EntitySchemasService.Default,
	EventSchemasService.Default,
	EventsService.Default,
	GodModeService.Default.pipe(Layer.provide(AuthService.Default)),
	QueryEngineService.Default,
	RelationshipSchemasService.Default,
	SavedViewsService.Default,
	TrackersService.Default,
	UploadsService.Default,
).pipe(Layer.provideMerge(SandboxServicesLive));

const ServiceDependenciesLive = ServicesLive.pipe(
	Layer.provide(CoreInfrastructureLive),
	Layer.provide(BaseInfrastructureLive),
	Layer.provide(ConfigLive),
);

const RuntimeLive = Layer.mergeAll(
	EntityImportWorkflowDefinitionsLive,
	SandboxWorkflowDefinitionsLive,
	ServerLive,
);

const RuntimeAfterMigrationsLive = MigrationsComplete.Default.pipe(
	Layer.flatMap(() => SeedService.Default.pipe(Layer.flatMap(() => RuntimeLive))),
);

export const AppLive = RuntimeAfterMigrationsLive.pipe(
	Layer.provide(ServiceDependenciesLive),
	Layer.provide(CoreInfrastructureLive),
	Layer.provide(BaseInfrastructureLive),
	Layer.provide(ConfigLive),
);
