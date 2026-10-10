import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventMutationsLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsServiceLive } from "#modules/relationships/layer";

import { UserCommandWorkflowDefinitionsLive } from "./workflow";

export const UserCommandWorkflowDefinitionsProvidedLive = UserCommandWorkflowDefinitionsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesServiceRuntimeLive,
			EntitiesRepositoryLive,
			EventMutationsLive,
			EventsRepository.layer,
			RelationshipsServiceLive,
			LifecycleServicesLive,
		),
	),
);
