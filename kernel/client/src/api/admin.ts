import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { makeContractClient, type ContractProgram } from "@ryot-app/contract/client";
import { Context, Data, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";
import { downloadFile } from "#/modules/downloads/file";

export class AdminApiError extends Data.TaggedError("AdminApiError")<{ readonly cause: unknown }> {}

export type AdminApiService = {
	readonly download: (
		origin: ServerOrigin,
		token: string,
		path: string,
		fileName: string,
	) => Effect.Effect<Blob | undefined, AdminApiError>;
	readonly run: <A, E>(
		origin: ServerOrigin,
		token: string,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AdminApiError>;
};

export const makeAdminApi = (http: HttpClient.HttpClient): AdminApiService => ({
	run: <A, E>(origin: ServerOrigin, token: string, program: ContractProgram<A, E>) =>
		makeContractClient(serverApiUrl(origin), { "Admin-Access-Token": token }).pipe(
			Effect.flatMap(program),
			Effect.provideService(HttpClient.HttpClient, http),
			Effect.mapError((cause) => new AdminApiError({ cause })),
		),
	download: (origin, token, path, fileName) =>
		downloadFile(http, {
			fileName,
			url: `${serverApiUrl(origin)}/${path}`,
			headers: { "Admin-Access-Token": token },
		}).pipe(
			Effect.mapError(
				(error) =>
					new AdminApiError({
						cause:
							error.status === 401
								? new AuthUnauthorized({ reason: { code: "admin-access-required" } })
								: error,
					}),
			),
		),
});

export class AdminApi extends Context.Service<AdminApi, AdminApiService>()("AdminApi", {
	make: Effect.map(HttpClient.HttpClient, makeAdminApi),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
