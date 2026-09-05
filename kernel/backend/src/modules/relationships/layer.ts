import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { RelationshipMutations } from "./mutation-pipeline";
import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const dependencies = Layer.mergeAll(
	RelationshipsRepository.layer,
	EntitiesRepositoryLive,
	LifecycleServicesLive,
);

export const RelationshipMutationsLive = RelationshipMutations.layer.pipe(
	Layer.provide(dependencies),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const RelationshipsServiceLive = RelationshipsService.layer.pipe(
	Layer.provide(Layer.merge(RelationshipMutationsLive, dependencies)),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
