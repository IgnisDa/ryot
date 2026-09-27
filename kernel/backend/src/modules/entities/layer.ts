import { Layer } from "effect";

import { LifecycleServicesLive, MigrationLifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemasRepositoryLive } from "#modules/event-schemas/layer";
import { EventsServiceLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";

import { EntitiesRepositoryLive } from "./repository";
import { EntitiesService } from "./service";

const EventsServiceMigrationLive = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsRepository.layer,
			EntitiesRepositoryLive,
			EventSchemasRepositoryLive,
			MigrationLifecycleServicesLive,
		),
	),
);

export const EntitiesServiceRuntimeLive = EntitiesService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			EventsRepository.layer,
			EventsServiceLive,
			LifecycleServicesLive,
		),
	),
);

export const EntitiesServiceMigrationLive = EntitiesService.layerMigration.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			EventsRepository.layer,
			EventsServiceMigrationLive,
			MigrationLifecycleServicesLive,
		),
	),
);
