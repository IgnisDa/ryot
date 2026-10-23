import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { EntityEditorService } from "./service";

export const EntityEditorServiceLive = EntityEditorService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesServiceRuntimeLive,
			RelationshipsServiceLive,
			LifecycleServicesLive,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
			MutationReceipts.layer,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
