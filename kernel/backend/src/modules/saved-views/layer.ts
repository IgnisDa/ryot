import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepositoryLive } from "#modules/plugins/packages/repository-layer";

import { SavedViewsRepository } from "./repository";
import { SavedViewPluginReferencesLive, SavedViewsService } from "./service";

export const SavedViewsServiceLive = SavedViewsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			SavedViewsRepository.layer,
			PluginRuntimeResolverLive,
			PluginInstallationRepository.layer,
			PluginRepositoryLive,
			PluginCatalogInvalidatorLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);

export const SavedViewPluginReferencesProvidedLive = SavedViewPluginReferencesLive.pipe(
	Layer.provide(SavedViewsServiceLive),
);
