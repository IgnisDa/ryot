import { Layer } from "effect";

import { PluginRepository } from "#modules/plugins/repository";

import { ScriptGarbageCollector } from "./scripts";

export const ScriptGarbageCollectorLive = ScriptGarbageCollector.layer.pipe(
	Layer.provide(PluginRepository.layer),
);
