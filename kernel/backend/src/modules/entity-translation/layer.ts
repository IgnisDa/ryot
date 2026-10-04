import { Layer } from "effect";

import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { TranslationsRepository } from "./repository";
import { TranslationsService } from "./service";

export const TranslationsServiceLive = TranslationsService.layer.pipe(
	Layer.provide(TranslationsRepository.layer),
	Layer.provide(DomainWriteChecksLive),
	Layer.provide(SandboxExecutionServiceLive),
	Layer.provide(PluginRuntimeResolverLive),
);
