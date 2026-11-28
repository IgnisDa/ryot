import { Layer } from "effect";

import { ChangeSetsLive } from "#modules/changes/layer";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { CollectionOrderingService } from "./ordering-service";
import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

export const CollectionsRepositoryLive = CollectionsRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);

const collectionsService = CollectionsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(CollectionsRepositoryLive, RelationshipSchemaReaderLive, ChangeSetsLive),
	),
);

export const CollectionsServiceLive = Layer.merge(
	collectionsService,
	CollectionOrderingService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				CollectionsRepositoryLive,
				EntitiesRepository.layer,
				RelationshipsRepository.layer,
			),
		),
	),
);
