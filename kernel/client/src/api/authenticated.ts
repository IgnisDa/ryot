import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { type ContractProgram, makeContractClient } from "@ryot-app/contract/client";
import { BROWSER_SESSION_HEADER } from "@ryot-app/contract/oauth";
import { EntitlementRequired } from "@ryot-app/contract/schema/entitlement";
import { AuthUnauthorized } from "@ryot-app/instance-contract/admin-auth";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import { serverApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { decodeOAuthTokenIdentity } from "#/modules/auth/token-identity";
import { type OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";

export class AuthenticatedApiError extends Schema.TaggedError<
	AuthenticatedApiError,
	{ readonly brand: unique symbol }
>()("AuthenticatedApiError", { cause: Schema.Unknown }) {}

export const isDemoOperationProtectedError = (
	error: unknown,
): error is AuthenticatedApiError & { readonly cause: DemoOperationProtected } =>
	error instanceof AuthenticatedApiError && error.cause instanceof DemoOperationProtected;

export const isEntitlementRequiredError = (
	error: unknown,
): error is AuthenticatedApiError & { readonly cause: EntitlementRequired } =>
	error instanceof AuthenticatedApiError && error.cause instanceof EntitlementRequired;

export type AuthenticatedApiService = {
	readonly authorization: (
		scope: ApiScope,
	) => Effect.Effect<Record<string, string>, AuthenticatedApiError>;
	readonly run: <A, E>(
		scope: ApiScope,
		program: ContractProgram<A, E>,
	) => Effect.Effect<A, AuthenticatedApiError>;
};

export const requestAuthorization = (
	tokens: OAuthTokenService["Service"],
	scope: ApiScope,
	forceRefresh = false,
) =>
	Effect.gen(function* (): Effect.fn.Return<
		null | Record<string, string>,
		OAuthTokenError | AuthenticatedApiError
	> {
		if (tokens.web) {
			const record = tokens.authorization.forServer(scope.serverUrl);
			if (record.current.browser === null || forceRefresh) {
				const { result } = yield* tokens.access(scope.serverUrl);
				yield* Effect.fromResult(result);
			}
			const profile = record.current.browser;
			if (profile === null) {
				return null;
			}
			if (profile.sub !== scope.userId) {
				return yield* new AuthenticatedApiError({
					cause: "Browser session does not match the API scope.",
				});
			}
			return { [BROWSER_SESSION_HEADER]: profile.session };
		}
		const token = yield* tokens.accessToken(scope.serverUrl, forceRefresh);
		if (token !== null && decodeOAuthTokenIdentity(token)?.sub !== scope.userId) {
			return yield* new AuthenticatedApiError({
				cause: "OAuth token does not match the API scope.",
			});
		}
		return token === null ? null : { authorization: `Bearer ${token}` };
	}).pipe(
		Effect.mapError((cause) =>
			cause instanceof AuthenticatedApiError ? cause : new AuthenticatedApiError({ cause }),
		),
	);

export const makeAuthenticatedApi = (
	tokens: OAuthTokenService["Service"],
	http: HttpClient.HttpClient,
): AuthenticatedApiService => ({
	authorization: (scope: ApiScope) =>
		requestAuthorization(tokens, scope).pipe(Effect.map((headers) => headers ?? {})),
	run: <A, E>(scope: ApiScope, program: ContractProgram<A, E>) => {
		const attempt = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const headers = yield* requestAuthorization(tokens, scope, forceRefresh);
				return yield* makeContractClient(serverApiUrl(scope.serverUrl), headers ?? {}).pipe(
					Effect.flatMap(program),
					Effect.provideService(HttpClient.HttpClient, http),
				);
			}).pipe(
				Effect.mapError((cause) =>
					cause instanceof AuthenticatedApiError ? cause : new AuthenticatedApiError({ cause }),
				),
			);
		return attempt(false).pipe(
			Effect.catchTag("AuthenticatedApiError", (error) =>
				!tokens.web &&
				error.cause instanceof AuthUnauthorized &&
				error.cause.reason.code === "authentication-required"
					? attempt(true)
					: Effect.fail(error),
			),
		);
	},
});

export class AuthenticatedApi extends Context.Service<AuthenticatedApi, AuthenticatedApiService>()(
	"@ryot-app/kernel-client/api/authenticated/AuthenticatedApi",
	{
		make: Effect.gen(function* () {
			return makeAuthenticatedApi(yield* OAuthTokenService, yield* HttpClient.HttpClient);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
