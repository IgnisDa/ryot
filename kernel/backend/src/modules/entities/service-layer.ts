import { Layer } from "effect";

import { LifecycleServicesLive, MigrationLifecycleServicesLive } from "#modules/automations/layer";
import { EventsRepository } from "#modules/events/repository";

import { EntitiesRepositoryLive } from "./repository";
import { EntitiesService } from "./service";
import { DomainWriteChecksLive } from "./write-context";

export const EntitiesServiceRuntimeLive = EntitiesService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			LifecycleServicesLive,
		),
	),
);

export const EntitiesServiceMigrationLive = EntitiesService.layerMigration.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			MigrationLifecycleServicesLive,
		),
	),
);
