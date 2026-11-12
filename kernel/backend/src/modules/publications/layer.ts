import { Layer } from "effect";

import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { ClientArtifactGrantService } from "#modules/pages/bundles/grant-service";
import { ReusableCapabilityGrantStoreLive } from "#modules/pages/bundles/reusable-capability-grants";
import { PagesServiceLive } from "#modules/pages/preparation/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { TransientValues } from "#platform/transient-values";

import { PublicationArtifactAuthorityLive } from "./artifact-authority";
import { PublicationVisitLimits } from "./limits";
import { PublicationsRepository } from "./repository";
import { PublicationRuntime } from "./runtime";
import { PublicationsService } from "./service";
import { PublicationSessions } from "./sessions";
import { PublicationVisitsService } from "./visits";

export const PublicationArtifactGrantsLive = ClientArtifactGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStoreLive),
	Layer.provide(
		PublicationArtifactAuthorityLive.pipe(
			Layer.provide(Layer.mergeAll(PublicationsRepository.layer, PublicationSessions.layer)),
		),
	),
	Layer.provide(TransientValues.layer),
);
const runtime = PublicationRuntime.layer.pipe(
	Layer.provide(Layer.mergeAll(PagesServiceLive, DefinitionCatalog.layer, RyotQLService.layer)),
);
export const PublicationsServiceLive = Layer.mergeAll(
	PublicationsService.layer,
	PublicationVisitsService.layer,
).pipe(
	Layer.provide(
		Layer.mergeAll(
			runtime,
			PublicationsRepository.layer,
			PublicationSessions.layer,
			PublicationVisitLimits.layer,
			RyotQLService.layer,
			PagesServiceLive,
			ManagedAssetsServiceLive,
			PublicationArtifactGrantsLive,
		),
	),
	Layer.provide(TransientValues.layer),
);
