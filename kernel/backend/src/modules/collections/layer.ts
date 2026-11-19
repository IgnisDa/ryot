import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { ChangeSetsLive } from "#modules/changes/layer";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { CollectionOrderingService } from "./ordering-service";
import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

export const CollectionsRepositoryLive = CollectionsRepository.layer.pipe(
	Layer.provide(DefinitionRepository.layer),
);

const collectionsService = CollectionsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			CollectionsRepositoryLive,
			EntitiesServiceRuntimeLive,
			RelationshipsServiceLive,
			RelationshipSchemaReaderLive,
			ChangeSetsLive,
			LifecycleServicesLive,
		),
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
