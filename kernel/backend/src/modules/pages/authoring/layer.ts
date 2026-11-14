import { Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { ClientPluginCompiler } from "#modules/pages/compiler";

import { PageAuthoringRepository } from "./repository";
import { PageAuthoringService } from "./service";

export const PageAuthoringServiceLive = PageAuthoringService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PageAuthoringRepository.layer,
			ClientPluginCompiler.layer,
			ClientArtifactsRepository.layer,
			DefinitionCatalog.layer,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
