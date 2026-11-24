import { Layer } from "effect";

import { LifecyclePlannerServiceLive, LifecycleServicesLive } from "#modules/automations/layer";
import { EventsRepository } from "#modules/events/repository";

import { EntitiesRepositoryLive } from "./repository";
import { EntitiesService } from "./service";
import { DomainWriteChecksLive } from "./write-context";

// Runtime and migration share one layer graph, so each builds its own service over its own
// lifecycle services instead of the first one memoized.
export const EntitiesServiceRuntimeLive = Layer.fresh(EntitiesService.layer).pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			LifecycleServicesLive,
		),
	),
);

export const EntitiesServiceMigrationLive = Layer.fresh(EntitiesService.layer).pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			LifecyclePlannerServiceLive,
		),
	),
);
