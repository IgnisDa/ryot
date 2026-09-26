import type { ContractRequest, ContractSuccess } from "@ryot-app/contract/client";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Context, Data, Effect, Layer, Result } from "effect";

import { AdminApi } from "#/api/admin";
import { resolveApiUrl, type ServerOrigin } from "#/api/origin";

export class GodModeQueryError extends Data.TaggedError("GodModeQueryError")<{
	readonly cause: unknown;
}> {}

export class GodModeApi extends Context.Service<GodModeApi>()("GodModeApi", {
	make: Effect.gen(function* () {
		const api = yield* AdminApi;
		return {
			listLogs: (origin: ServerOrigin, token: string, after: string | undefined, limit: number) =>
				api.run(origin, token, (client) => client.serverLogs.list({ query: { limit, after } })),
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
								: Effect.fail(new GodModeQueryError({ cause: decoded.failure }));
						}),
					),
			downloadLogs: (
				origin: ServerOrigin,
				token: string,
				file?: ContractSuccess<"serverLogs", "list">["files"][number],
			) => {
				const fileName =
					file?.name ?? `ryot-server-logs-${new Date().toISOString().replaceAll(":", "-")}.zip`;
				const request =
					file === undefined
						? api.run(origin, token, (client) => client.serverLogs.createAllDownloadTicket())
						: api.run(origin, token, (client) =>
								client.serverLogs.createFileDownloadTicket({ params: { id: file.id } }),
							);
				return request.pipe(
					Effect.flatMap(({ url }) => api.download(resolveApiUrl(origin, url), fileName)),
				);
			},
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
