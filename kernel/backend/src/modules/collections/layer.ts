import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EventsServiceLive } from "#modules/events/layer";
import { RelationshipSchemasRepositoryLive } from "#modules/relationship-schemas/layer";
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
			EventsServiceLive,
			RelationshipsServiceLive,
			RelationshipSchemasRepositoryLive,
		),
	),
);
