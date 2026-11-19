import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { EntityUserDataGraphRepository } from "./graph-repository";
import { EntityUserDataService } from "./service";

export const EntityUserDataServiceLive = EntityUserDataService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			RelationshipsServiceLive,
			LifecycleServicesLive,
			EventsRepository.layer,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
			EntityUserDataGraphRepository.layer,
		),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
