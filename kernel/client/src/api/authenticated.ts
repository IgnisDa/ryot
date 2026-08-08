import { AuthUnauthorized } from "@ryot/contract/auth-middleware";
import { runContract, type ContractProgram } from "@ryot/contract/client";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthTokenService } from "#/modules/auth/token-service";

export class AuthenticatedApiError extends Data.TaggedError("AuthenticatedApiError")<{
	readonly cause: unknown;
}> {}

export type AuthenticatedApiService = {
	readonly run: <A, E>(
		scope: ApiScope,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AuthenticatedApiError>;
};

export const makeAuthenticatedApi = (
	tokens: OAuthTokenService["Service"],
	runtimeClient: RuntimeOAuthClientService["Service"],
): AuthenticatedApiService => ({
	run: <A, E>(scope: ApiScope, program: ContractProgram<A, E>) =>
		Effect.gen(function* () {
			const { clientId } = yield* runtimeClient
				.forServer(scope.serverUrl)
				.pipe(Effect.mapError((cause) => new AuthenticatedApiError({ cause })));
			const attempt = (forceRefresh: boolean) =>
				Effect.gen(function* () {
					const token = yield* tokens.accessToken(scope.serverUrl, clientId, forceRefresh);
					return yield* Effect.tryPromise({
						try: (signal) =>
							runContract(program, {
								signal,
								baseUrl: serverApiUrl(scope.serverUrl),
								...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
							}),
						catch: (cause) => new AuthenticatedApiError({ cause }),
					});
				}).pipe(
					Effect.mapError((cause) =>
						cause instanceof AuthenticatedApiError ? cause : new AuthenticatedApiError({ cause }),
					),
				);
			return yield* attempt(false).pipe(
				Effect.catchTag("AuthenticatedApiError", (error) =>
					error.cause instanceof AuthUnauthorized &&
					error.cause.reason.code === "authentication-required"
						? attempt(true)
						: Effect.fail(error),
				),
			);
		}),
});

export class AuthenticatedApi extends Context.Service<AuthenticatedApi, AuthenticatedApiService>()(
	"AuthenticatedApi",
	{
		make: Effect.gen(function* () {
			return makeAuthenticatedApi(yield* OAuthTokenService, yield* RuntimeOAuthClientService);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
