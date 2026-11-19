import { Layer } from "effect";

import { ChangeSetsLive } from "#modules/changes/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { EntityEditorService } from "./service";

export const EntityEditorServiceLive = EntityEditorService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ChangeSetsLive,
			EntitiesRepositoryLive,
			RelationshipsRepository.layer,
			IdempotencyKeys.layer,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
