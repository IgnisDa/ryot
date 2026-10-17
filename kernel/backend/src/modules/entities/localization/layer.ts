import { Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

import { TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";

export const TranslationsServiceLive = TranslationsService.layer.pipe(
	Layer.provide(TranslationsRepository.layer),
	Layer.provide(DefinitionRepository.layer),
	Layer.provide(DomainWriteChecksLive),
	Layer.provide(ScriptExecutionServiceLive),
	Layer.provide(PluginRuntimeResolverLive),
);
