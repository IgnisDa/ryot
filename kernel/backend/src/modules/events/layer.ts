import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";

import { EventsRepository } from "./repository";
import { EventsService } from "./service";

export const EventsServiceLive = EventsService.layer.pipe(
	Layer.provide(Layer.merge(EventsRepository.layer, LifecycleServicesLive)),
);
