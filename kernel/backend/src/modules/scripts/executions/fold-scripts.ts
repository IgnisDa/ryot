import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import {
	findRevisionScriptForSession,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { ScriptExecutionPrincipal, type ScriptPluginRevision } from "../authorization/principal";
import { SandboxRepository } from "../registry/repository";

/** Resolves a plugin's fold script for a user, under the read-only `projection` subject. */
export class FoldScripts extends Context.Service<
	FoldScripts,
	{
		resolve: (input: {
			userId: UserId;
			pluginId: string;
			scriptSlug: string;
		}) => Effect.Effect<
			null | {
				pluginPin: ScriptPluginRevision;
				principal: ScriptExecutionPrincipal;
				accountGeneration: AccountGeneration;
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
				const accountGeneration = yield* admission.currentAccount(input.userId);
				const subject = { accountGeneration, userId: input.userId, type: "projection" as const };
				const pin = yield* scripts
					.getScriptPin(script.id, undefined, subject)
					.pipe(Effect.catchTag("SandboxRunError", () => Effect.succeed(null)));
				if (!pin?.pluginRevision || pin.pluginRevision.id !== PluginId.make(input.pluginId)) {
					return null;
				}
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
					...pin,
					subject,
				}).pipe(Effect.mapError(() => new DbError({ message: "Invalid fold authority" })));
				return { principal, accountGeneration, pluginPin: pin.pluginRevision };
			}),
		});
	}),
).pipe(Layer.provide(SandboxRepository.layer), Layer.provide(PluginRuntimeResolverLive));
