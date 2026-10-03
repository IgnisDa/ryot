import { Layer } from "effect";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { PluginRepository } from "#modules/plugins/repository";

import { ScriptGarbageCollector } from "./scripts";

export const ScriptGarbageCollectorLive = ScriptGarbageCollector.layer.pipe(
	Layer.provide(Layer.merge(PluginRepository.layer, PackageCacheManager.layer)),
);
