import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventSchemasRepositoryLive } from "#modules/event-schemas/layer";

import { EventCreateWorkflowDefinitionsLive } from "./event-create-workflow-live";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";
import { EventStreamRepository } from "./stream-repository";
import { EventStreamWorkService } from "./stream-work";

export const EventsServiceLive = EventsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemasRepositoryLive,
			LifecycleServicesLive,
		),
	),
);

export const EventCreateWorkflowDefinitionsProvidedLive = EventCreateWorkflowDefinitionsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemasRepositoryLive,
			EventsRepository.layer,
		),
	),
);

export const EventStreamWorkServiceLive = EventStreamWorkService.layer.pipe(
	Layer.provide(
		Layer.merge(
			EventsServiceLive,
			Layer.mergeAll(
				EventStreamRepository.layer,
				EventsRepository.layer,
				EntitiesRepositoryLive,
				DomainWriteChecksLive,
				EventSchemasRepositoryLive,
				LifecycleServicesLive,
			),
		),
	),
);
