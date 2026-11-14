import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
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
			IdempotencyKeys.layer,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
