import { Layer } from "effect";

import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { ManagedAssetReferencesRepository } from "#modules/assets/storage/managed-asset-references-repository";
import { CollectionsRepositoryLive } from "#modules/collections/layer";
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
				Layer.provide(Layer.merge(SavedViewsRepository.layer, CollectionsRepositoryLive)),
			),
			PublicationsRepository.layer,
			PublicationSessions.layer,
			PublicationVisitLimits.layer,
			RyotQLService.layer,
			PagesServiceLive,
			ManagedAssetsServiceLive,
			ManagedAssetReferencesRepository.layer,
		),
	),
);
