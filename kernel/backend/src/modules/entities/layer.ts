import { Layer } from "effect";

import { ChangeSetsLive } from "#modules/changes/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { DeclaredLifecycleWorkLive } from "./lifecycle-work";
import { PluginBootstrapEntitiesLive } from "./plugin-bootstrap-entities";
import { PluginMembershipWrites } from "./plugin-memberships";
import { EntitiesRepositoryLive } from "./repository";
import { EntityGraphCollector } from "./retention/collector";
import { EntityRetentionRepository } from "./retention/repository";

export const PluginBootstrapEntitiesRuntimeLive = PluginBootstrapEntitiesLive.pipe(
	Layer.provide(ChangeSetsLive),
);

export const EntityGraphCollectorLive = EntityGraphCollector.layer.pipe(
	Layer.provide(EntityRetentionRepository.layer),
);

export const DeclaredLifecycleWorkProvidedLive = DeclaredLifecycleWorkLive.pipe(
	Layer.provide(
		PluginMembershipWrites.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					EventsRepository.layer,
					EntitiesRepositoryLive,
					EventSchemaReaderLive,
					RelationshipsRepository.layer,
				),
			),
		),
	),
);
