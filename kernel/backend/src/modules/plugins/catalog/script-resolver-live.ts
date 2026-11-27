import { Effect, Layer } from "effect";

import { SandboxPluginScriptResolver } from "#modules/scripts/registry/plugin-script-resolver";

import { PluginRuntimeResolver } from "./runtime-resolver";

export const PluginSandboxScriptResolverLive = Layer.effect(
	SandboxPluginScriptResolver,
	Effect.map(PluginRuntimeResolver, (runtime) => ({
		findWorkflowScriptAvailableToUser: (...args) =>
			runtime.findWorkflowScriptAvailableToUser(...args),
		findActiveScriptById: (scriptId, executingUserId) =>
			runtime.findActiveScriptById(scriptId, executingUserId),
	})),
);
