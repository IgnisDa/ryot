import { Layer } from "effect";

import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { ManagedAssetReferencesRepository } from "#modules/assets/storage/managed-asset-references-repository";
import { PagesServiceLive } from "#modules/pages/preparation/layer";
import { RyotQLService } from "#modules/ryotql/service";

import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationsService } from "./service";
import { PublicationSessions } from "./sessions";
import { PublicationVisitsService } from "./visits";

export const PublicationsServiceLive = Layer.mergeAll(
	PublicationsService.layer,
	PublicationVisitsService.layer,
).pipe(
	Layer.provide(
		Layer.mergeAll(
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
