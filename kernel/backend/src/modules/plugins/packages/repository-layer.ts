import { Layer } from "effect";

import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";

import { PluginRepository } from "./repository";

export const PluginRepositoryLive = PluginRepository.layer.pipe(
	Layer.provide(ClientArtifactsRepository.layer),
);
