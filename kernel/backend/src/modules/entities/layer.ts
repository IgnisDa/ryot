import { Layer } from "effect";

import { LifecycleServicesLive, MigrationLifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { DeclaredLifecycleWorkLive } from "./lifecycle-work";
import { PluginMembershipWrites } from "./plugin-memberships";
import { EntitiesRepositoryLive } from "./repository";
import { EntityGraphCollector } from "./retention/collector";
import { EntityRetentionRepository } from "./retention/repository";
import { EntitiesService } from "./service";
import { DomainWriteChecksLive } from "./write-context";

export const EntitiesServiceRuntimeLive = EntitiesService.layerRuntime.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			LifecycleServicesLive,
		),
	),
);

export const EntitiesServiceMigrationLive = EntitiesService.layerMigration.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesRepositoryLive,
			DomainWriteChecksLive,
			EventsRepository.layer,
			MigrationLifecycleServicesLive,
		),
	),
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
