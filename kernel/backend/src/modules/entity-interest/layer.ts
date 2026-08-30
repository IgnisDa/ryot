import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { TranslationsServiceLive } from "#modules/entity-translation/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { EntityPopulationTriggerLive } from "#modules/provider-entities/population-trigger-live";
import { RyotQLService } from "#modules/ryotql/service";

import { LocalInterestSessions } from "./connections";
import { EntityInterestProgression } from "./progression";
import { InterestReconciler } from "./reconciler";
import { InterestService } from "./service";
import { EntityInterestStore } from "./store";
import { EntityInterestSubscriber } from "./subscriber";
import { EntityInterestTicketService } from "./ticket-service";

export const EntityInterestStateLive = Layer.merge(
	EntityInterestStore.layer,
	LocalInterestSessions.layer,
);

export const InterestReconcilerLive = InterestReconciler.layer.pipe(
	Layer.provide(
		Layer.mergeAll(RyotQLService.layer, EntityPopulationTriggerLive, TranslationsServiceLive),
	),
	Layer.provide(PluginRuntimeResolverLive),
);

export const EntityInterestProgressionLive = EntityInterestProgression.layer.pipe(
	Layer.provide(
		Layer.mergeAll(EntityInterestStateLive, EntitiesServiceRuntimeLive, TranslationsServiceLive),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const InterestServicesLive = Layer.mergeAll(
	EntityInterestStateLive,
	InterestReconcilerLive,
	InterestService.layer.pipe(
		Layer.provide(Layer.merge(EntityInterestStateLive, InterestReconcilerLive)),
	),
	EntityInterestTicketService.layer,
	EntityInterestProgressionLive,
	EntityInterestSubscriber.layer.pipe(
		Layer.provide(Layer.merge(EntityInterestStateLive, EntityInterestProgressionLive)),
	),
);
