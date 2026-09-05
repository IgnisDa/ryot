import { Layer } from "effect";

import { ReusableCapabilityGrantStoreLive } from "#lib/infrastructure/reusable-capability-grants";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStoreLive } from "#modules/client-artifacts/layer";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { ClientPageCompositionService } from "./composition-service";
import { ClientDocumentGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

export const ClientDocumentGrantServiceLive = ClientDocumentGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStoreLive),
);

const composition = ClientPageCompositionService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientPagesRepository.layer,
			ClientArtifactStoreLive,
			ImageClientArtifacts.layer,
		),
	),
);

export const ClientPagesServiceLive = ClientPagesService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientPagesRepository.layer,
			EntitiesRepository.layer.pipe(Layer.provide(PluginRuntimeResolverLive)),
			composition,
			ClientDocumentGrantServiceLive,
			ImageClientArtifacts.layer,
			PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer)),
			PluginRuntimeResolverLive,
		),
	),
	Layer.provide(DefinitionRepository.layer),
);
