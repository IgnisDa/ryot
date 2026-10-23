import { Layer } from "effect";

import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";

import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

export const CollectionsRepositoryLive = CollectionsRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);

export const CollectionsServiceLive = CollectionsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			CollectionsRepositoryLive,
			EntitiesServiceRuntimeLive,
			RelationshipsServiceLive,
			RelationshipSchemaReaderLive,
		),
	),
);
