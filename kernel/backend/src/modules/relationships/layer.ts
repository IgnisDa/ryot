import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { BackgroundWorkService } from "#modules/background-work/service";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";

import { RelationshipMutationPipeline } from "./mutation-pipeline";
import { RelationshipProjectionRepository } from "./projections/repository";
import { RelationshipProjectionService } from "./projections/service";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const dependencies = Layer.mergeAll(
	RelationshipsRepository.layer,
	EntitiesRepositoryLive,
	DomainWriteChecksLive,
	LifecycleServicesLive,
);

export const RelationshipMutationPipelineLive = RelationshipMutationPipeline.layer.pipe(
	Layer.provide(dependencies),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const RelationshipsServiceLive = RelationshipsService.layer.pipe(
	Layer.provide(Layer.merge(RelationshipMutationPipelineLive, dependencies)),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const RelationshipProjectionServiceLive = RelationshipProjectionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			RelationshipProjectionRepository.layer,
			BackgroundWorkService.layer,
			DomainWriteChecksLive,
			RelationshipSchemaReaderLive,
		),
	),
);
