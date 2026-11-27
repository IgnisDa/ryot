import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventMutationsLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsServiceLive } from "#modules/relationships/layer";

import { UserCommands } from "./service";

export const UserCommandsLive = UserCommands.layer.pipe(
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
