import { DbError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";

import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";

import { PluginRuntimeResolver } from "./runtime-resolver";
import { PluginValidationError } from "./validation";

export const PluginSandboxScriptResolverLive = Layer.effect(
	SandboxPluginScriptResolver,
	Effect.map(PluginRuntimeResolver, (runtime) => ({
		findActiveScriptById: (scriptId, executingUserId) =>
			runtime.findActiveScriptById(scriptId, executingUserId),
		findWorkflowScriptAvailableToUser: (...args) =>
			runtime
				.findWorkflowScriptAvailableToUser(...args)
				.pipe(
					Effect.mapError((error) =>
						error instanceof PluginValidationError
							? new DbError({ message: String(error) })
							: error,
					),
				),
	})),
);
