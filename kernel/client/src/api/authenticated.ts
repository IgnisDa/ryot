import { AuthUnauthorized } from "@ryot/contract/auth-middleware";
import { runContract, type ContractProgram } from "@ryot/contract/client";
import { OAUTH_NATIVE_CLIENT_ID, OAUTH_WEB_CLIENT_ID } from "@ryot/contract/oauth";
import { Context, Data, Effect, Layer } from "effect";

import { serverApiUrl } from "#/api/origin";
import { canonicalApiScope, type ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";

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
	isNative: () => boolean = isNativePlatform,
): AuthenticatedApiService => ({
	run: <A, E>(scope: ApiScope, program: ContractProgram<A, E>) =>
		Effect.gen(function* () {
			const canonical = canonicalApiScope(scope);
			const clientId = isNative() ? OAUTH_NATIVE_CLIENT_ID : OAUTH_WEB_CLIENT_ID;
			const attempt = (forceRefresh: boolean) =>
				Effect.gen(function* () {
					const token = yield* tokens.accessToken(canonical.serverUrl, clientId, forceRefresh);
					return yield* Effect.tryPromise({
						try: (signal) =>
							runContract(program, {
								signal,
								baseUrl: serverApiUrl(canonical.serverUrl),
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
	{ make: Effect.map(OAuthTokenService, (tokens) => makeAuthenticatedApi(tokens)) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
