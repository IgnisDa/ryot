import { Layer } from "effect";

import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { PagesServiceLive } from "#modules/pages/preparation/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationsService } from "./service";
import { PublicationSessions } from "./sessions";
import { PublicationSources } from "./sources";
import { PublicationVisitsService } from "./visits";

export const PublicationsServiceLive = Layer.mergeAll(
	PublicationsService.layer,
	PublicationVisitsService.layer,
).pipe(
	Layer.provide(
		Layer.mergeAll(
			PublicationSources.layer.pipe(
				Layer.provideMerge(PublicationsRepository.layer),
				Layer.provide(SavedViewsRepository.layer),
			),
			PublicationSessions.layer,
			PublicationVisitLimits.layer,
			RyotQLService.layer,
			PagesServiceLive,
			ManagedAssetsServiceLive,
		),
	),
);
