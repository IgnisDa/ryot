import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";

import { EventMutations } from "./mutations";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";

export const EventsServiceLive = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemaReaderLive,
			LifecycleServicesLive,
		),
	),
);

export const EventMutationsLive = EventMutations.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemaReaderLive,
			LifecycleServicesLive,
		),
	),
);
