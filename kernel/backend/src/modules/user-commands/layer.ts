import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventMutationsLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";

import { UserCommands } from "./service";

export const UserCommandsLive = UserCommands.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesServiceRuntimeLive,
			EntitiesRepositoryLive,
			EventMutationsLive,
			EventsRepository.layer,
			RelationshipsServiceLive,
			LifecycleServicesLive,
			PluginUserSettingsWriter.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						PluginCatalogInvalidatorLive,
						PluginRepository.layer,
						PluginInstallationRepository.layer,
					),
				),
			),
		),
	),
);
