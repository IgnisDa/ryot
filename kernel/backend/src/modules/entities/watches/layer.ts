import { Layer } from "effect";

import { ImpersonationSessions } from "#modules/accounts/auth/impersonation-sessions";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { TranslationsServiceLive } from "#modules/entities/localization/layer";
import { EntityPopulationTriggerLive } from "#modules/entities/providers/population-trigger-live";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { RyotQLService } from "#modules/ryotql/service";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

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
		Layer.mergeAll(
			RyotQLService.layer,
			EntityPopulationTriggerLive.pipe(
				Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
			),
			TranslationsServiceLive,
		),
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
	EntityInterestTicketService.layer.pipe(Layer.provideMerge(ImpersonationSessions.layer)),
	EntityInterestProgressionLive,
	EntityInterestSubscriber.layer.pipe(
		Layer.provide(Layer.merge(EntityInterestStateLive, EntityInterestProgressionLive)),
	),
);
