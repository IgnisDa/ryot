import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog-events";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepositoryLive } from "#modules/plugins/repository-layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

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
