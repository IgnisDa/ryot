import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventSchemasRepositoryLive } from "#modules/event-schemas/layer";

import { EventCreateWorkflowDefinitionsLive } from "./event-create-workflow-live";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";

export const EventsServiceLive = EventsService.layer.pipe(
	Layer.provide(Layer.merge(EventsRepository.layer, LifecycleServicesLive)),
);

export const EventCreateWorkflowDefinitionsProvidedLive = EventCreateWorkflowDefinitionsLive.pipe(
	Layer.provide(
		Layer.mergeAll(EntitiesRepositoryLive, EventSchemasRepositoryLive, EventsRepository.layer),
	),
);
