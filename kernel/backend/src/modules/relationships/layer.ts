import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

export const RelationshipsServiceLive = RelationshipsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(RelationshipsRepository.layer, EntitiesRepositoryLive, LifecycleServicesLive),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
