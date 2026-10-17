import type { ContractRequest, ContractSuccess } from "@ryot-app/contract/client";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Context, Data, Effect, Layer, Result } from "effect";

import { AdminApi } from "#/api/admin";
import { resolveApiUrl, type ServerOrigin } from "#/api/origin";

export class InstanceAdminQueryError extends Data.TaggedError("InstanceAdminQueryError")<{
	readonly cause: unknown;
}> {}

export class InstanceAdminApi extends Context.Service<InstanceAdminApi>()("InstanceAdminApi", {
	make: Effect.gen(function* () {
		const api = yield* AdminApi;
		return {
			listLogs: (origin: ServerOrigin, token: string, after: string | undefined, limit: number) =>
				api.run(origin, token, (client) => client.serverLogs.list({ query: { limit, after } })),
			resetUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"instanceAdmin", "resetUser">,
			) => api.run(origin, token, (client) => client.instanceAdmin.resetUser(request)),
			deleteUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"instanceAdmin", "deleteUser">,
			) => api.run(origin, token, (client) => client.instanceAdmin.deleteUser(request)),
			setUserDisabled: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"instanceAdmin", "setUserDisabled">,
			) => api.run(origin, token, (client) => client.instanceAdmin.setUserDisabled(request)),
			resetUserPassword: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"instanceAdmin", "resetUserPassword">,
			) => api.run(origin, token, (client) => client.instanceAdmin.resetUserPassword(request)),
			startUserImpersonation: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"instanceAdmin", "startUserImpersonation">,
			) => api.run(origin, token, (client) => client.instanceAdmin.startUserImpersonation(request)),
			query: <A>(origin: ServerOrigin, token: string, recipe: PreparedRecipe<A>) =>
				api
					.run(origin, token, (client) => client.adminRyotql.execute({ payload: recipe.document }))
					.pipe(
						Effect.flatMap((response) => {
							const decoded = recipe.decode(response);
							return Result.isSuccess(decoded)
								? Effect.succeed(decoded.success)
								: Effect.fail(new InstanceAdminQueryError({ cause: decoded.failure }));
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
