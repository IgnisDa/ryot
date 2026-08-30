import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";

import { EventSchemasRepository } from "./repository";

export const EventSchemasRepositoryLive = EventSchemasRepository.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
