import type { DbError } from "@ryot-app/contract/errors";
import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import {
	findRevisionScriptForSession,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import type { ScriptExecutionPrincipal, ScriptPluginRevision } from "../authorization/principal";
import { SandboxRepository } from "../registry/repository";

export class FoldScripts extends Context.Service<
	FoldScripts,
	{
		resolve: (input: {
			userId: UserId;
			pluginId: string;
			scriptSlug: string;
		}) => Effect.Effect<
			null | {
				accountUserId: UserId;
				pluginPin: ScriptPluginRevision;
				principal: ScriptExecutionPrincipal;
			},
			DbError
		>;
	}
>()("@ryot-app/kernel-backend/modules/scripts/executions/fold-scripts/FoldScripts") {}

export const FoldScriptsLive = Layer.effect(
	FoldScripts,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const scripts = yield* SandboxRepository;
		const session = yield* DatabaseSession;
		const admission = yield* AccountAdmission.make;
		const findScript = findRevisionScriptForSession(session);
		return FoldScripts.of({
			resolve: Effect.fn("FoldScripts.resolve")(function* (input) {
				const plugin = yield* runtime.findPluginAvailableToUser(input.userId, input.pluginId);
				if (!plugin) {
					return null;
				}
				const script = yield* findScript(plugin.pluginRevisionId, input.scriptSlug);
				if (script?.metadata.kind !== "script") {
					return null;
				}
				const accountUserId = yield* admission.currentAccount(input.userId);
				const principal = yield* scripts
					.pinnedPrincipal(script.id, { type: "projection", userId: input.userId })
					.pipe(Effect.catchTag("SandboxRunError", () => Effect.succeed(null)));
				if (
					!principal?.pluginRevision ||
					principal.pluginRevision.id !== PluginId.make(input.pluginId)
				) {
					return null;
				}
				return { principal, accountUserId, pluginPin: principal.pluginRevision };
			}),
		});
	}),
).pipe(Layer.provide(SandboxRepository.layer), Layer.provide(PluginRuntimeResolverLive));
