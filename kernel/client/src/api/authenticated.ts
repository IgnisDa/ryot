import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { makeContractClient, type ContractProgram } from "@ryot-app/contract/client";
import { Context, Data, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";

export class AuthenticatedApiError extends Data.TaggedError("AuthenticatedApiError")<{
	readonly cause: unknown;
}> {}

export const isDemoOperationProtectedError = (
	error: unknown,
): error is AuthenticatedApiError & { readonly cause: DemoOperationProtected } =>
	error instanceof AuthenticatedApiError && error.cause instanceof DemoOperationProtected;

export type AuthenticatedApiService = {
	readonly run: <A, E>(
		scope: ApiScope,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AuthenticatedApiError>;
	readonly authorization: (
		scope: ApiScope,
	) => Effect.Effect<Record<string, string>, AuthenticatedApiError>;
};

export const makeAuthenticatedApi = (
	tokens: OAuthTokenService["Service"],
	http: HttpClient.HttpClient,
): AuthenticatedApiService => ({
	authorization: (scope: ApiScope) =>
		Effect.gen(function* () {
			const token = yield* tokens.accessToken(scope.serverUrl);
			const headers: Record<string, string> = {};
			if (token !== null) {
				headers.Authorization = `Bearer ${token}`;
			}
			return headers;
		}).pipe(Effect.mapError((cause) => new AuthenticatedApiError({ cause }))),
	run: <A, E>(scope: ApiScope, program: ContractProgram<A, E>) => {
		const attempt = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* tokens.accessToken(scope.serverUrl, forceRefresh);
				return yield* makeContractClient(
					serverApiUrl(scope.serverUrl),
					token ? { Authorization: `Bearer ${token}` } : {},
				).pipe(Effect.flatMap(program), Effect.provideService(HttpClient.HttpClient, http));
			}).pipe(
				Effect.mapError((cause) =>
					cause instanceof AuthenticatedApiError ? cause : new AuthenticatedApiError({ cause }),
				),
			);
		return attempt(false).pipe(
			Effect.catchTag("AuthenticatedApiError", (error) =>
				error.cause instanceof AuthUnauthorized &&
				error.cause.reason.code === "authentication-required"
					? attempt(true)
					: Effect.fail(error),
			),
		);
	},
});

export class AuthenticatedApi extends Context.Service<AuthenticatedApi, AuthenticatedApiService>()(
	"AuthenticatedApi",
	{
		make: Effect.gen(function* () {
			return makeAuthenticatedApi(yield* OAuthTokenService, yield* HttpClient.HttpClient);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
