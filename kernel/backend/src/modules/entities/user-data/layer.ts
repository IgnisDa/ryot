import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsServiceLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { EntityUserDataService } from "./service";

export const EntityUserDataServiceLive = EntityUserDataService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsServiceLive,
			RelationshipsServiceLive,
			LifecycleServicesLive,
			EventsRepository.layer,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
			MutationReceipts.layer,
		),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
