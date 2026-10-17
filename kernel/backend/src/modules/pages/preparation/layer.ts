import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { ImageClientArtifacts } from "#modules/pages/bundles/image-artifacts";
import {
	ClientArtifactGrantServiceLive,
	ClientArtifactStoreLive,
} from "#modules/pages/bundles/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginRepositoryLive } from "#modules/plugins/packages/repository-layer";

import { ClientPageCompositionService } from "./composition-service";
import { PagesRepository } from "./repository";
import { PagesService } from "./service";

const composition = ClientPageCompositionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(PagesRepository.layer, ClientArtifactStoreLive, ImageClientArtifacts.layer),
	),
);

export const PagesServiceLive = PagesService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			PagesRepository.layer,
			EntitiesRepository.layer.pipe(Layer.provide(PluginRuntimeResolverLive)),
			composition,
			ClientArtifactStoreLive,
			ClientArtifactGrantServiceLive,
			ImageClientArtifacts.layer,
			PluginRepositoryLive,
			PluginRuntimeResolverLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
