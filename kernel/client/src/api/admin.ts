import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { makeContractClient, type ContractProgram } from "@ryot-app/contract/client";
import { Context, Data, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { serverApiUrl, type ServerOrigin } from "#/api/origin";
import { FileDownloads } from "#/modules/downloads/file";

export class AdminApiError extends Data.TaggedError("AdminApiError")<{ readonly cause: unknown }> {}

export type AdminApiService = {
	readonly download: (url: string, fileName: string) => Effect.Effect<void, AdminApiError>;
	readonly run: <A, E>(
		origin: ServerOrigin,
		token: string,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AdminApiError>;
};

export const makeAdminApi = (
	http: HttpClient.HttpClient,
	downloads: FileDownloads["Service"],
): AdminApiService => ({
	download: (url, fileName) =>
		downloads
			.download({ url, fileName })
			.pipe(
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
	run: <A, E>(origin: ServerOrigin, token: string, program: ContractProgram<A, E>) =>
		makeContractClient(serverApiUrl(origin), { "Admin-Access-Token": token }).pipe(
			Effect.flatMap(program),
			Effect.provideService(HttpClient.HttpClient, http),
			Effect.mapError((cause) => new AdminApiError({ cause })),
		),
});

export class AdminApi extends Context.Service<AdminApi, AdminApiService>()("AdminApi", {
	make: Effect.gen(function* () {
		return makeAdminApi(yield* HttpClient.HttpClient, yield* FileDownloads);
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
