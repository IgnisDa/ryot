import { DbError } from "@ryot-app/contract/errors";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { EventProjectionBindings } from "#modules/events/stream-work";
import { MutationReceipts } from "#modules/mutations/receipts";
import {
	findRevisionScriptForSession,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { ScriptExecutionPrincipal } from "../authorization/principal";
import { SandboxRepository } from "../registry/repository";

export const EventProjectionBindingsLive = Layer.effect(
	EventProjectionBindings,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const scripts = yield* SandboxRepository;
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts.make;
		const findScript = findRevisionScriptForSession(session);
		return EventProjectionBindings.of({
			resolve: Effect.fn("EventProjectionBindings.resolve")(function* (input) {
				const plugin = yield* runtime.findPluginAvailableToUser(input.userId, input.pluginId);
				if (!plugin) {
					return null;
				}
				const script = yield* findScript(plugin.pluginRevisionId, input.scriptSlug);
				if (script?.metadata.kind !== "script") {
					return null;
				}
				const accountGeneration = yield* receipts.currentAccount(input.userId);
				const subject = {
					accountGeneration,
					userId: input.userId,
					type: "event-projection" as const,
				};
				const pin = yield* scripts
					.getScriptPin(script.id, undefined, subject)
					.pipe(Effect.catchTag("SandboxRunError", () => Effect.succeed(null)));
				if (!pin?.pluginRevision || pin.pluginRevision.id !== PluginId.make(input.pluginId)) {
					return null;
				}
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
					...pin,
					subject,
				}).pipe(Effect.mapError(() => new DbError({ message: "Invalid projection authority" })));
				return { principal, accountGeneration, pluginPin: pin.pluginRevision };
			}),
		});
	}),
).pipe(Layer.provide(SandboxRepository.layer), Layer.provide(PluginRuntimeResolverLive));
