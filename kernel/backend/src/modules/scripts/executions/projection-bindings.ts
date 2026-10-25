import { DbError } from "@ryot-app/contract/errors";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";
import {
	findRevisionScriptForSession,
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { ScriptExecutionPrincipal, type ScriptPluginRevision } from "../authorization/principal";
import { SandboxRepository } from "../registry/repository";

export class ProjectionBindings extends Context.Service<
	ProjectionBindings,
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
>()("@ryot-app/kernel-backend/modules/scripts/executions/projection-bindings/ProjectionBindings") {}

export type ProjectionBindingRecord = {
	readonly accountToken: string;
	readonly pluginPin: JsonValue;
	readonly outputSchema: AppSchema;
	readonly pluginRevisionId: string;
	readonly processorScriptId: string;
};

export const sameProjectionBinding = (
	left: ProjectionBindingRecord,
	right: ProjectionBindingRecord,
) =>
	left.accountToken === right.accountToken &&
	left.processorScriptId === right.processorScriptId &&
	left.pluginRevisionId === right.pluginRevisionId &&
	stableStringify(left.pluginPin) === stableStringify(right.pluginPin) &&
	stableStringify(left.outputSchema) === stableStringify(right.outputSchema);

export const ProjectionBindingsLive = Layer.effect(
	ProjectionBindings,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const scripts = yield* SandboxRepository;
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts.make;
		const findScript = findRevisionScriptForSession(session);
		return ProjectionBindings.of({
			resolve: Effect.fn("ProjectionBindings.resolve")(function* (input) {
				const plugin = yield* runtime.findPluginAvailableToUser(input.userId, input.pluginId);
				if (!plugin) {
					return null;
				}
				const script = yield* findScript(plugin.pluginRevisionId, input.scriptSlug);
				if (script?.metadata.kind !== "script") {
					return null;
				}
				const accountGeneration = yield* receipts.currentAccount(input.userId);
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
				}).pipe(Effect.mapError(() => new DbError({ message: "Invalid projection authority" })));
				return { principal, accountGeneration, pluginPin: pin.pluginRevision };
			}),
		});
	}),
).pipe(Layer.provide(SandboxRepository.layer), Layer.provide(PluginRuntimeResolverLive));
