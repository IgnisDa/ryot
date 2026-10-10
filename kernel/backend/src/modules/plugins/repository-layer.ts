import { Layer } from "effect";

import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";

import { PluginRepository } from "./repository";

export const PluginRepositoryLive = PluginRepository.layer.pipe(
	Layer.provide(ClientArtifactsRepository.layer),
);
