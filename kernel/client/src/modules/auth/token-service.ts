import {
	OAuthTokenResponse,
	OAuthUserInfoResponse,
	getOAuthEndpoint,
	getOAuthResource,
	OAUTH_END_SESSION_PATH,
	OAUTH_REVOKE_PATH,
	OAUTH_TOKEN_PATH,
	OAUTH_USERINFO_PATH,
	type OAuthUserInfoResponse as OAuthUserInfo,
	type PendingAuthorization,
	type StoredTokenSet,
} from "@ryot/contract/oauth";
import { Context, Data, Effect, Layer, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import {
	postOAuthForm,
	postOAuthFormRequest,
	type OAuthFetch,
} from "#/modules/auth/oauth-endpoint";
import { OAuthStorage, type OAuthStorageError } from "#/modules/auth/oauth-storage";
import { makeOriginSingleFlight } from "#/modules/auth/single-flight";

const REFRESH_WINDOW_MS = 60_000;
const IdTokenClaims = Schema.Struct({ nonce: Schema.String });

const decodeIdTokenNonce = (token: string) => {
	const payload = token.split(".")[1];
	if (!payload) {
		throw new Error("ID token payload is missing");
	}
	const base64 = payload
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(payload.length / 4) * 4, "=");
	return Schema.decodeUnknownSync(IdTokenClaims)(JSON.parse(atob(base64))).nonce;
};

const storedTokenSet = (
	response: typeof OAuthTokenResponse.Type,
	current?: StoredTokenSet,
): StoredTokenSet => {
	const refreshToken = response.refresh_token ?? current?.refreshToken;
	const idToken = response.id_token ?? current?.idToken;
	if (!refreshToken || !idToken) {
		throw new Error("OAuth token response did not include the required tokens");
	}
	return {
		idToken,
		refreshToken,
		scope: response.scope,
		tokenType: response.token_type,
		accessToken: response.access_token,
		accessTokenExpiresAt: response.expires_at * 1000,
	};
};

export class OAuthTokenError extends Data.TaggedError("OAuthTokenError")<{
	readonly reason:
		| "invalid-grant"
		| "invalid-nonce"
		| "request-failed"
		| "storage-failed"
		| "invalid-callback"
		| "missing-authorization"
		| "authorization-rejected";
	readonly cause?: unknown;
}> {}

const requestFailed = (cause: unknown) => new OAuthTokenError({ cause, reason: "request-failed" });

const fromStorage = <A>(effect: Effect.Effect<A, OAuthStorageError>) =>
	effect.pipe(
		Effect.catchTag("OAuthStorageError", (cause) =>
			Effect.fail(new OAuthTokenError({ cause, reason: "storage-failed" })),
		),
	);

const makeTokenService = (
	storage: OAuthStorage["Service"],
	fetcher: OAuthFetch,
	now: () => number,
): OAuthTokenService["Service"] => {
	const refreshes = makeOriginSingleFlight<StoredTokenSet, OAuthTokenError>();

	const rotate = (canonical: ServerOrigin, clientId: string) =>
		Effect.gen(function* () {
			const current = yield* fromStorage(storage.getTokenSet(canonical));
			if (!current) {
				return yield* Effect.fail(new OAuthTokenError({ reason: "missing-authorization" }));
			}
			const response = yield* postOAuthForm(
				fetcher,
				canonical,
				OAUTH_TOKEN_PATH,
				new URLSearchParams({
					client_id: clientId,
					grant_type: "refresh_token",
					refresh_token: current.refreshToken,
					resource: getOAuthResource(canonical),
				}),
				OAuthTokenResponse,
			).pipe(
				Effect.catchTags({
					SchemaError: (cause) => Effect.fail(requestFailed(cause)),
					OAuthTransportError: (cause) => Effect.fail(requestFailed(cause)),
					OAuthEndpointError: (cause) =>
						cause.code === "invalid_grant"
							? Effect.gen(function* () {
									yield* storage.removeTokenSet(canonical);
									return yield* Effect.fail(
										new OAuthTokenError({ cause, reason: "invalid-grant" }),
									);
								})
							: Effect.fail(requestFailed(cause)),
				}),
			);
			const tokens = yield* Effect.try({
				catch: requestFailed,
				try: () => storedTokenSet(response, current),
			});
			yield* fromStorage(
				storage
					.setTokenSet(canonical, tokens)
					.pipe(Effect.tapError(() => storage.removeTokenSet(canonical))),
			);
			return tokens;
		});

	const refresh = (origin: ServerOrigin, clientId: string) =>
		refreshes(origin, rotate(origin, clientId));

	const accessToken = Effect.fn("OAuthTokenService.accessToken")(function* (
		origin: ServerOrigin,
		clientId: string,
		forceRefresh = false,
	) {
		const current = yield* fromStorage(storage.getTokenSet(origin));
		if (!current) {
			return null;
		}
		if (!forceRefresh && current.accessTokenExpiresAt - now() > REFRESH_WINDOW_MS) {
			return current.accessToken;
		}
		const refreshed = yield* refresh(origin, clientId);
		return refreshed.accessToken;
	});

	const userInfo = Effect.fn("OAuthTokenService.userInfo")(function* (
		origin: ServerOrigin,
		clientId: string,
	) {
		const request = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* accessToken(origin, clientId, forceRefresh);
				if (!token) {
					return null;
				}
				return yield* Effect.tryPromise({
					catch: requestFailed,
					try: () =>
						fetcher(getOAuthEndpoint(origin, OAUTH_USERINFO_PATH), {
							cache: "no-store",
							credentials: "omit",
							headers: { authorization: `Bearer ${token}` },
						}),
				});
			});
		const first = yield* request(false);
		if (first === null) {
			return null;
		}
		const response = first.status === 401 ? yield* request(true) : first;
		if (response === null || !response.ok) {
			return yield* Effect.fail(new OAuthTokenError({ reason: "request-failed" }));
		}
		const payload = yield* Effect.tryPromise({
			catch: requestFailed,
			try: () => response.json() as Promise<unknown>,
		});
		return yield* Schema.decodeUnknownEffect(OAuthUserInfoResponse)(payload).pipe(
			Effect.catchTag("SchemaError", (cause) => Effect.fail(requestFailed(cause))),
		);
	});

	const completeAuthorization = Effect.fn("OAuthTokenService.completeAuthorization")(function* (
		origin: ServerOrigin,
		expectedClientId: PendingAuthorization["clientId"],
		expectedRedirectUri: string,
		state: string,
		code: string,
	) {
		const pending = yield* fromStorage(storage.takePending(origin, state));
		if (!pending) {
			return yield* Effect.fail(new OAuthTokenError({ reason: "missing-authorization" }));
		}
		if (
			pending.serverOrigin !== origin ||
			pending.clientId !== expectedClientId ||
			pending.redirectUri !== expectedRedirectUri
		) {
			return yield* Effect.fail(new OAuthTokenError({ reason: "invalid-callback" }));
		}
		const response = yield* postOAuthForm(
			fetcher,
			origin,
			OAUTH_TOKEN_PATH,
			new URLSearchParams({
				code,
				client_id: pending.clientId,
				grant_type: "authorization_code",
				redirect_uri: pending.redirectUri,
				code_verifier: pending.codeVerifier,
				resource: getOAuthResource(origin),
			}),
			OAuthTokenResponse,
		).pipe(
			Effect.catchTags({
				SchemaError: (cause) => Effect.fail(requestFailed(cause)),
				OAuthEndpointError: (cause) => Effect.fail(requestFailed(cause)),
				OAuthTransportError: (cause) => Effect.fail(requestFailed(cause)),
			}),
		);
		const tokens = yield* Effect.try({ catch: requestFailed, try: () => storedTokenSet(response) });
		const nonce = yield* Effect.try({
			try: () => decodeIdTokenNonce(tokens.idToken),
			catch: (cause) => new OAuthTokenError({ cause, reason: "invalid-nonce" }),
		});
		if (nonce !== pending.nonce) {
			return yield* Effect.fail(new OAuthTokenError({ reason: "invalid-nonce" }));
		}
		yield* fromStorage(storage.setTokenSet(origin, tokens));
		return pending;
	});

	const rejectAuthorization = Effect.fn("OAuthTokenService.rejectAuthorization")(function* (
		origin: ServerOrigin,
		state: string,
	) {
		const pending = yield* fromStorage(storage.takePending(origin, state));
		return yield* Effect.fail(
			new OAuthTokenError({ reason: pending ? "authorization-rejected" : "missing-authorization" }),
		);
	});

	const logout = Effect.fn("OAuthTokenService.logout")(function* (
		origin: ServerOrigin,
		clientId: string,
		postLogoutRedirectUri: string,
	) {
		const clearLocal = Effect.all([storage.removeTokenSet(origin), storage.clearPending(origin)], {
			discard: true,
		});
		const current = yield* fromStorage(storage.getTokenSet(origin));
		if (!current) {
			yield* clearLocal;
			return null;
		}
		return yield* Effect.gen(function* () {
			yield* Effect.all(
				(
					[
						[current.refreshToken, "refresh_token"],
						[current.accessToken, "access_token"],
					] as const
				).map(([token, tokenTypeHint]) =>
					postOAuthFormRequest(
						fetcher,
						origin,
						OAUTH_REVOKE_PATH,
						new URLSearchParams({ token, client_id: clientId, token_type_hint: tokenTypeHint }),
					).pipe(Effect.catch(() => Effect.void)),
				),
				{ discard: true },
			);
			const url = new URL(getOAuthEndpoint(origin, OAUTH_END_SESSION_PATH));
			url.search = new URLSearchParams({
				client_id: clientId,
				id_token_hint: current.idToken,
				post_logout_redirect_uri: postLogoutRedirectUri,
			}).toString();
			return url.toString();
		}).pipe(Effect.ensuring(clearLocal));
	});

	return {
		logout,
		userInfo,
		accessToken,
		rejectAuthorization,
		completeAuthorization,
		clear: (origin) =>
			Effect.all([storage.removeTokenSet(origin), storage.clearPending(origin)], {
				discard: true,
			}),
	};
};

export class OAuthTokenService extends Context.Service<
	OAuthTokenService,
	{
		readonly logout: (
			origin: ServerOrigin,
			clientId: string,
			postLogoutRedirectUri: string,
		) => Effect.Effect<string | null, OAuthTokenError>;
		readonly clear: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly accessToken: (
			origin: ServerOrigin,
			clientId: string,
			forceRefresh?: boolean,
		) => Effect.Effect<string | null, OAuthTokenError>;
		readonly userInfo: (
			origin: ServerOrigin,
			clientId: string,
		) => Effect.Effect<OAuthUserInfo | null, OAuthTokenError>;
		readonly rejectAuthorization: (
			origin: ServerOrigin,
			state: string,
		) => Effect.Effect<never, OAuthTokenError>;
		readonly completeAuthorization: (
			origin: ServerOrigin,
			expectedClientId: PendingAuthorization["clientId"],
			expectedRedirectUri: string,
			state: string,
			code: string,
		) => Effect.Effect<PendingAuthorization, OAuthTokenError>;
	}
>()("OAuthTokenService") {
	static readonly layer = Layer.effect(
		this,
		Effect.map(OAuthStorage, (storage) => makeTokenService(storage, fetch, Date.now)),
	);
}

export const oauthTokenServiceLayer = (fetcher: OAuthFetch, now: () => number = Date.now) =>
	Layer.effect(
		OAuthTokenService,
		Effect.map(OAuthStorage, (storage) => makeTokenService(storage, fetcher, now)),
	);
