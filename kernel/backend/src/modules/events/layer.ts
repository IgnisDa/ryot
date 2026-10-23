import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";

import { EventCreateWorkflowDefinitionsLive } from "./event-create-workflow-live";
import { EventMutations } from "./mutations";
import { EventProjectionRepository } from "./projection-repository";
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

export const EventCreateWorkflowDefinitionsProvidedLive = EventCreateWorkflowDefinitionsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemaReaderLive,
			EventsRepository.layer,
			EventMutationsLive,
		),
	),
);

export const EventStreamWorkServiceLive = EventStreamWorkService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EventStreamRepository.layer,
			EventProjectionRepository.layer,
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventSchemaReaderLive,
		),
	),
);
