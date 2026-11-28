import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";

import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

export const RelationshipsServiceLive = RelationshipsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			RelationshipsRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			LifecycleServicesLive,
		),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
