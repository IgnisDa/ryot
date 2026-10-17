import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginEntitySaveOutcome } from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer } from "effect";

import { isDemoOperationProtectedError } from "#/api/authenticated";
import { EntitiesApi, isDeclaredEntitySaveFailure } from "#/api/entities";
import type { ApiScope } from "#/api/scope";

export class PluginEntitySaves extends Context.Service<PluginEntitySaves>()("PluginEntitySaves", {
	make: Effect.gen(function* () {
		const api = yield* EntitiesApi;
		const outcome = (
			scope: ApiScope,
			contributors: PreparedClientPage["identity"]["contributors"],
			request: EntityEditorSaveRequest,
		): Effect.Effect<PluginEntitySaveOutcome> => {
			const owner = request.submission.entitySchema.owner;
			if (
				owner.kind !== "plugin" ||
				!contributors.some(
					(contributor) => contributor.kind === "plugin" && contributor.pluginId === owner.pluginId,
				)
			) {
				return Effect.succeed({ outcome: "failure", reason: "invalid-request" });
			}
			return api
				.saveEditor(scope, { payload: request })
				.pipe(
					Effect.match({
						onSuccess: (result) => ({ outcome: "success", output: result.output }) as const,
						onFailure: (error) =>
							({
								outcome: "failure",
								reason:
									isDeclaredEntitySaveFailure(error) || isDemoOperationProtectedError(error)
										? "entity-save-failed"
										: "transport",
							}) as const,
					}),
				);
		};
		return { outcome };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
