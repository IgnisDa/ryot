import { Layer } from "effect";

import { CalendarSourcesRepository } from "./repository";
import { CalendarSourcesService } from "./service";

export const CalendarSourcesServiceLive = CalendarSourcesService.layer.pipe(
	Layer.provide(CalendarSourcesRepository.layer),
);
