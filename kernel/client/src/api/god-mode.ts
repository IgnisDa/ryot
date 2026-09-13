import type { ContractRequest } from "@ryot-app/contract/client";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Context, Effect, Layer, Result } from "effect";

import { AdminApi } from "#/api/admin";
import type { ServerOrigin } from "#/api/origin";

export class GodModeApi extends Context.Service<GodModeApi>()("GodModeApi", {
	make: Effect.gen(function* () {
		const api = yield* AdminApi;
		return {
			resetUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "resetUser">,
			) => api.run(origin, token, (client) => client.godMode.resetUser(request)),
			deleteUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "deleteUser">,
			) => api.run(origin, token, (client) => client.godMode.deleteUser(request)),
			setUserDisabled: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "setUserDisabled">,
			) => api.run(origin, token, (client) => client.godMode.setUserDisabled(request)),
			resetUserPassword: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "resetUserPassword">,
			) => api.run(origin, token, (client) => client.godMode.resetUserPassword(request)),
			query: <A>(origin: ServerOrigin, token: string, recipe: PreparedRecipe<A>) =>
				api
					.run(origin, token, (client) => client.adminRyotql.execute({ payload: recipe.document }))
					.pipe(
						Effect.flatMap((response) => {
							const decoded = recipe.decode(response);
							return Result.isSuccess(decoded)
								? Effect.succeed(decoded.success)
								: Effect.fail(decoded.failure);
						}),
					),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
