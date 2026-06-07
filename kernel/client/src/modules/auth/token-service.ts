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

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";
import {
	OAuthEndpointError,
	postOAuthForm,
	postOAuthFormRequest,
	type OAuthFetch,
} from "#/modules/auth/oauth-endpoint";
import { OAuthStorage, OAuthStorageError } from "#/modules/auth/oauth-storage";

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

const makeTokenService = (
	storage: OAuthStorage["Service"],
	fetcher: OAuthFetch,
	now: () => number,
): OAuthTokenService["Service"] => {
	const refreshes = new Map<ServerOrigin, Promise<StoredTokenSet>>();
	const run = <A>(promise: () => Promise<A>) =>
		Effect.tryPromise({
			try: promise,
			catch: (cause) => {
				if (cause instanceof OAuthTokenError) {
					return cause;
				}
				return cause instanceof OAuthStorageError
					? new OAuthTokenError({ reason: "storage-failed", cause })
					: new OAuthTokenError({ reason: "request-failed", cause });
			},
		});
	const refresh = (origin: ServerOrigin, clientId: string) => {
		const canonical = normalizeServerOrigin(origin);
		const existing = refreshes.get(canonical);
		if (existing) {
			return existing;
		}
		const pending = (async () => {
			const current = await Effect.runPromise(storage.getTokenSet(canonical));
			if (!current) {
				throw new OAuthTokenError({ reason: "missing-authorization" });
			}
			try {
				const response = await postOAuthForm(
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
				);
				const tokens = storedTokenSet(response, current);
				await Effect.runPromise(
					storage
						.setTokenSet(canonical, tokens)
						.pipe(Effect.tapError(() => storage.removeTokenSet(canonical))),
				);
				return tokens;
			} catch (cause) {
				if (cause instanceof OAuthEndpointError && cause.code === "invalid_grant") {
					await Effect.runPromise(storage.removeTokenSet(canonical));
					throw new OAuthTokenError({ reason: "invalid-grant", cause });
				}
				throw cause;
			}
		})().finally(() => refreshes.delete(canonical));
		refreshes.set(canonical, pending);
		return pending;
	};
	const accessToken = (origin: ServerOrigin, clientId: string, forceRefresh = false) =>
		run(async () => {
			const canonical = normalizeServerOrigin(origin);
			const current = await Effect.runPromise(storage.getTokenSet(canonical));
			if (!current) {
				return null;
			}
			if (!forceRefresh && current.accessTokenExpiresAt - now() > REFRESH_WINDOW_MS) {
				return current.accessToken;
			}
			const refreshed = await refresh(canonical, clientId);
			return refreshed.accessToken;
		});
	const userInfo = (origin: ServerOrigin, clientId: string) =>
		run(async () => {
			const request = async (forceRefresh: boolean) => {
				const token = await Effect.runPromise(accessToken(origin, clientId, forceRefresh));
				if (!token) {
					return null;
				}
				return fetcher(getOAuthEndpoint(origin, OAUTH_USERINFO_PATH), {
					cache: "no-store",
					credentials: "omit",
					headers: { authorization: `Bearer ${token}` },
				});
			};
			let response = await request(false);
			if (response === null) {
				return null;
			}
			if (response.status === 401) {
				response = await request(true);
			}
			if (response === null || !response.ok) {
				throw new OAuthTokenError({ reason: "request-failed" });
			}
			return Schema.decodeUnknownSync(OAuthUserInfoResponse)(await response.json());
		});
	const completeAuthorization = (
		origin: ServerOrigin,
		expectedClientId: PendingAuthorization["clientId"],
		expectedRedirectUri: string,
		state: string,
		code: string,
	) =>
		run(async () => {
			const canonical = normalizeServerOrigin(origin);
			const pending = await Effect.runPromise(storage.takePending(canonical, state));
			if (!pending) {
				throw new OAuthTokenError({ reason: "missing-authorization" });
			}
			if (
				normalizeServerOrigin(pending.serverOrigin) !== canonical ||
				pending.clientId !== expectedClientId ||
				pending.redirectUri !== expectedRedirectUri
			) {
				throw new OAuthTokenError({ reason: "invalid-callback" });
			}
			const response = await postOAuthForm(
				fetcher,
				canonical,
				OAUTH_TOKEN_PATH,
				new URLSearchParams({
					code,
					client_id: pending.clientId,
					grant_type: "authorization_code",
					redirect_uri: pending.redirectUri,
					code_verifier: pending.codeVerifier,
					resource: getOAuthResource(canonical),
				}),
				OAuthTokenResponse,
			);
			const tokens = storedTokenSet(response);
			let nonce: string;
			try {
				nonce = decodeIdTokenNonce(tokens.idToken);
			} catch (cause) {
				throw new OAuthTokenError({ reason: "invalid-nonce", cause });
			}
			if (nonce !== pending.nonce) {
				throw new OAuthTokenError({ reason: "invalid-nonce" });
			}
			await Effect.runPromise(storage.setTokenSet(canonical, tokens));
			return pending;
		});
	const rejectAuthorization = (origin: ServerOrigin, state: string) =>
		run(async () => {
			const pending = await Effect.runPromise(storage.takePending(origin, state));
			if (!pending) {
				throw new OAuthTokenError({ reason: "missing-authorization" });
			}
			throw new OAuthTokenError({ reason: "authorization-rejected" });
		});
	const logout = (origin: ServerOrigin, clientId: string, postLogoutRedirectUri: string) =>
		run(async () => {
			const canonical = normalizeServerOrigin(origin);
			const current = await Effect.runPromise(storage.getTokenSet(canonical));
			try {
				if (!current) {
					return null;
				}
				await Promise.allSettled(
					(
						[
							[current.refreshToken, "refresh_token"],
							[current.accessToken, "access_token"],
						] as const
					).map(([token, tokenTypeHint]) =>
						postOAuthFormRequest(
							fetcher,
							canonical,
							OAUTH_REVOKE_PATH,
							new URLSearchParams({
								token,
								client_id: clientId,
								token_type_hint: tokenTypeHint,
							}),
						),
					),
				);
				const url = new URL(getOAuthEndpoint(canonical, OAUTH_END_SESSION_PATH));
				url.search = new URLSearchParams({
					client_id: clientId,
					id_token_hint: current.idToken,
					post_logout_redirect_uri: postLogoutRedirectUri,
				}).toString();
				return url.toString();
			} finally {
				await Promise.all([
					Effect.runPromise(storage.removeTokenSet(canonical)),
					Effect.runPromise(storage.clearPending(canonical)),
				]);
			}
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
