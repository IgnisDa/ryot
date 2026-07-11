import { Effect, Layer } from "effect";

import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";

import { PluginRuntimeResolver } from "./runtime-resolver";

export const PluginSandboxScriptResolverLive = Layer.effect(
	SandboxPluginScriptResolver,
	Effect.map(PluginRuntimeResolver, (runtime) => ({
		findActiveScriptById: runtime.findActiveScriptById,
		findActiveWorkflowScript: runtime.findActiveWorkflowScript,
	})),
);
