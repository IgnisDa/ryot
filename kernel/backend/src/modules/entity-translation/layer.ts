import { Layer } from "effect";

import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";

export const TranslationsServiceLive = TranslationsService.layer.pipe(
	Layer.provide(TranslationsRepository.layer),
	Layer.provide(SandboxExecutionServiceLive),
	Layer.provide(PluginRuntimeResolverLive),
);
