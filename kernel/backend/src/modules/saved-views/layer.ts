import { Layer } from "effect";

import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog-events";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { SavedViewsRepository } from "./repository";
import { SavedViewPluginReferencesLive, SavedViewsService } from "./service";

export const SavedViewsServiceLive = SavedViewsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			SavedViewsRepository.layer,
			PluginRuntimeResolverLive,
			PluginInstallationRepository.layer,
			PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer)),
			PluginCatalogInvalidatorLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);

export const SavedViewPluginReferencesProvidedLive = SavedViewPluginReferencesLive.pipe(
	Layer.provide(SavedViewsServiceLive),
);
