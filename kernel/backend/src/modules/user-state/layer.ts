import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsServiceLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { UserStateService } from "./service";

export const UserStateServiceLive = UserStateService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsServiceLive,
			RelationshipsServiceLive,
			LifecycleServicesLive,
			EventsRepository.layer,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
		),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
