import { Layer } from "effect";

import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { FoldMarks } from "#modules/derived-values/marks";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/service-layer";
import { EntityUserDataServiceLive } from "#modules/entities/user-data/layer";
import { EventMutationsLive } from "#modules/events/layer";
import { EventsRepository } from "#modules/events/repository";
import { NotificationsServiceLive } from "#modules/notifications/layer";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";

import { ScriptChangesLayer } from "./script-changes";
import { ChangeSets } from "./service";

export const ChangeSetsLive = ChangeSets.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			EntitiesServiceRuntimeLive,
			EntitiesRepositoryLive,
			EntityUserDataServiceLive,
			EventMutationsLive,
			EventsRepository.layer,
			RelationshipsServiceLive,
			LifecycleServicesLive,
			SignalEmissionServiceLive,
			NotificationsServiceLive,
			FoldMarks.layer,
			SandboxRepository.layer,
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

export const ScriptChangesLive = ScriptChangesLayer.pipe(Layer.provide(ChangeSetsLive));
