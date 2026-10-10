import { Layer } from "effect";

import { LifecycleServicesLive, MigrationLifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { EventsServiceLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";

import { EntitiesRepositoryLive } from "./repository";
import { EntitiesService } from "./service";
import { DomainWriteChecksLive } from "./write-context";

const EventsServiceMigrationLive = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemaReaderLive,
			MigrationLifecycleServicesLive,
		),
	),
);

export const EntitiesServiceRuntimeLive = EntitiesService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
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
			DomainWriteChecksLive,
			EventsRepository.layer,
			EventsServiceMigrationLive,
			MigrationLifecycleServicesLive,
		),
	),
);
