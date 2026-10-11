import {
	type AccessClass,
	getOAuthEndpoint,
	getOAuthResource,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_END_SESSION_PATH,
	OAUTH_IMPERSONATION_CLIENT_IDS,
	OAUTH_REVOKE_PATH,
	OAUTH_TOKEN_PATH,
	OAUTH_USERINFO_PATH,
	type OAuthClientId,
	OAuthTokenResponse,
	type OAuthUserInfoResponse as OAuthUserInfo,
	OAuthUserInfoResponse,
	type PendingAuthorization,
	type StoredTokenSet,
} from "@ryot-app/contract/oauth";
import { Context, Data, Effect, Layer, Result, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { type Authorization, makeAuthorizationState } from "#/modules/auth/authorization";
import {
	type OAuthFetch,
	postOAuthForm,
	postOAuthFormRequest,
} from "#/modules/auth/oauth-endpoint";
import { OAuthStorage, type OAuthStorageError } from "#/modules/auth/oauth-storage";
import { decodeOAuthTokenClaims } from "#/modules/auth/token-claims";

const REFRESH_WINDOW_MS = 60_000;
const IdTokenClaims = Schema.Struct({ nonce: Schema.String });

const storedTokenSet = (
	response: OAuthTokenResponse,
	clientId: OAuthClientId,
	current?: StoredTokenSet,
): StoredTokenSet => {
	const refreshToken = response.refresh_token ?? current?.refreshToken;
	const idToken = response.id_token ?? current?.idToken;
	if (!refreshToken || !idToken) {
		throw new Error("OAuth token response did not include the required tokens");
	}
	return {
		idToken,
		clientId,
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
	const authorization = makeAuthorizationState();
	const load = Effect.fnUntraced(function* (origin: ServerOrigin) {
		const record = authorization.forServer(origin);
		return yield* record.mutex.withPermit(
			Effect.gen(function* () {
				const before = record.current;
				const stored = yield* fromStorage(storage.getTokenSet(origin));
				return record.isCurrent(before) ? record.observe(stored) : record.current;
			}),
		);
	});
	const clearTokens = Effect.fnUntraced(function* (origin: ServerOrigin, current?: Authorization) {
		const record = authorization.forServer(origin);
		if (current && !record.isCurrent(current)) {
			return;
		}
		const cleared = record.replace(null);
		yield* record.mutex.withPermit(
			Effect.gen(function* () {
				if (record.isCurrent(cleared)) {
					yield* fromStorage(storage.removeTokenSet(origin));
				}
			}),
		);
	});

	const rotate = Effect.fnUntraced(function* (canonical: ServerOrigin, originating: Authorization) {
		const record = authorization.forServer(canonical);
		const current = originating.tokens;
		if (!record.isCurrent(originating)) {
			return null;
		}
		if (!current) {
			return yield* new OAuthTokenError({ reason: "missing-authorization" });
		}
		const response = yield* postOAuthForm(
			fetcher,
			canonical,
			OAUTH_TOKEN_PATH,
			new URLSearchParams({
				client_id: current.clientId,
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
								yield* clearTokens(canonical, originating);
								return yield* new OAuthTokenError({ cause, reason: "invalid-grant" });
							})
						: Effect.fail(requestFailed(cause)),
			}),
		);
		const tokens = yield* Effect.try({
			catch: requestFailed,
			try: () => storedTokenSet(response, current.clientId, current),
		});
		return yield* record.mutex.withPermit(
			Effect.gen(function* () {
				if (!record.isCurrent(originating)) {
					return null;
				}
				yield* fromStorage(
					storage
						.setTokenSet(canonical, tokens)
						.pipe(Effect.tapError(() => storage.removeTokenSet(canonical))),
				).pipe(
					Effect.tapError(() =>
						Effect.sync(() => {
							if (record.isCurrent(originating)) {
								record.replace(null);
							}
						}),
					),
				);
				if (!record.isCurrent(originating)) {
					return null;
				}
				originating.tokens = tokens;
				return tokens;
			}),
		);
	});

	const accessFor = Effect.fnUntraced(function* (
		origin: ServerOrigin,
		current: Authorization,
		forceRefresh: boolean,
	) {
		if (!current.tokens || !authorization.forServer(origin).isCurrent(current)) {
			return null;
		}
		if (!forceRefresh && current.tokens.accessTokenExpiresAt - now() > REFRESH_WINDOW_MS) {
			return current.tokens.accessToken;
		}
		const refreshed = yield* current.refresh(rotate(origin, current));
		return refreshed?.accessToken ?? null;
	});

	const accessToken = Effect.fn("OAuthTokenService.accessToken")(function* (
		origin: ServerOrigin,
		forceRefresh = false,
	) {
		const record = authorization.forServer(origin);
		let refresh = forceRefresh;
		for (;;) {
			const current = yield* load(origin);
			const result = yield* accessFor(origin, current, refresh).pipe(Effect.result);
			if (!record.isCurrent(current)) {
				if (
					Result.isFailure(result) &&
					record.current.tokens === null &&
					(result.failure.reason === "storage-failed" || result.failure.reason === "invalid-grant")
				) {
					return yield* result.failure;
				}
				refresh = false;
				continue;
			}
			return Result.isFailure(result) ? yield* result.failure : result.success;
		}
	});

	const userInfo = Effect.fn("OAuthTokenService.userInfo")(function* (
		origin: ServerOrigin,
		current: Authorization,
	) {
		const record = authorization.forServer(origin);
		const request = (forceRefresh: boolean) =>
			Effect.gen(function* () {
				const token = yield* accessFor(origin, current, forceRefresh);
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
		if (!record.isCurrent(current)) {
			return null;
		}
		if (response === null || !response.ok) {
			return yield* new OAuthTokenError({ reason: "request-failed" });
		}
		const payload = yield* Effect.tryPromise({
			catch: requestFailed,
			try: () => response.json() as Promise<unknown>,
		});
		const user = yield* Schema.decodeUnknownEffect(OAuthUserInfoResponse)(payload).pipe(
			Effect.catchTag("SchemaError", (cause) => Effect.fail(requestFailed(cause))),
		);
		if (!record.isCurrent(current) || !current.tokens) {
			return null;
		}
		const accessClass: AccessClass =
			current.tokens.clientId === OAUTH_DEMO_WEB_CLIENT_ID ? "demo" : "standard";
		return { ...user, accessClass };
	});

	const completeAuthorization = Effect.fn("OAuthTokenService.completeAuthorization")(function* (
		origin: ServerOrigin,
		expectedClientIds: readonly PendingAuthorization["clientId"][],
		expectedRedirectUri: string,
		state: string,
		code: string,
	) {
		const pending = yield* storage.getPending(origin, state);
		if (!pending) {
			return yield* new OAuthTokenError({ reason: "missing-authorization" });
		}
		const terminalFailure = (error: OAuthTokenError) =>
			storage.removePending(origin, state).pipe(Effect.andThen(Effect.fail(error)));
		if (
			pending.serverOrigin !== origin ||
			!expectedClientIds.includes(pending.clientId) ||
			pending.redirectUri !== expectedRedirectUri
		) {
			return yield* terminalFailure(new OAuthTokenError({ reason: "invalid-callback" }));
		}
		const originating = yield* load(origin);
		const response = yield* postOAuthForm(
			fetcher,
			origin,
			OAUTH_TOKEN_PATH,
			new URLSearchParams({
				code,
				client_id: pending.clientId,
				grant_type: "authorization_code",
				redirect_uri: pending.redirectUri,
				resource: getOAuthResource(origin),
				code_verifier: pending.codeVerifier,
			}),
			OAuthTokenResponse,
		).pipe(
			Effect.catchTags({
				SchemaError: (cause) => terminalFailure(requestFailed(cause)),
				OAuthTransportError: (cause) => Effect.fail(requestFailed(cause)),
				OAuthEndpointError: (cause) => terminalFailure(requestFailed(cause)),
			}),
		);
		const tokens = yield* Effect.try({
			catch: requestFailed,
			try: () => storedTokenSet(response, pending.clientId),
		}).pipe(Effect.catch(terminalFailure));
		const nonce = yield* Effect.try({
			try: () => decodeOAuthTokenClaims(tokens.idToken, IdTokenClaims).nonce,
			catch: (cause) => new OAuthTokenError({ cause, reason: "invalid-nonce" }),
		}).pipe(Effect.catch(terminalFailure));
		if (nonce !== pending.nonce) {
			return yield* terminalFailure(new OAuthTokenError({ reason: "invalid-nonce" }));
		}
		if (!(yield* storage.getPending(origin, state))) {
			return yield* new OAuthTokenError({ reason: "missing-authorization" });
		}
		yield* storage.removePending(origin, state);
		const record = authorization.forServer(origin);
		yield* Effect.uninterruptible(
			record.mutex.withPermit(
				Effect.gen(function* () {
					if (!record.isCurrent(originating)) {
						return yield* new OAuthTokenError({ reason: "missing-authorization" });
					}
					yield* fromStorage(storage.setTokenSet(origin, tokens));
					if (!record.isCurrent(originating)) {
						return yield* new OAuthTokenError({ reason: "missing-authorization" });
					}
					return record.replace(tokens);
				}),
			),
		);
		return pending;
	});

	const rejectAuthorization = Effect.fn("OAuthTokenService.rejectAuthorization")(function* (
		origin: ServerOrigin,
		state: string,
	) {
		const pending = yield* fromStorage(storage.takePending(origin, state));
		return yield* new OAuthTokenError({
			reason: pending ? "authorization-rejected" : "missing-authorization",
		});
	});

	const logout = Effect.fn("OAuthTokenService.logout")(function* (
		origin: ServerOrigin,
		postLogoutRedirectUri: string,
	) {
		const originating = yield* load(origin);
		const clearLocal = Effect.gen(function* () {
			if (authorization.forServer(origin).isCurrent(originating)) {
				yield* clearTokens(origin, originating);
				yield* storage.clearPending(origin);
			}
		});
		const current = originating.tokens;
		if (!current) {
			yield* clearLocal;
			return null;
		}
		const impersonating = OAUTH_IMPERSONATION_CLIENT_IDS.some(
			(clientId) => clientId === current.clientId,
		);
		if (!impersonating) {
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
						new URLSearchParams({
							token,
							client_id: current.clientId,
							token_type_hint: tokenTypeHint,
						}),
					).pipe(Effect.catch(() => Effect.void)),
				),
				{ discard: true },
			);
		}
		const url = new URL(getOAuthEndpoint(origin, OAUTH_END_SESSION_PATH));
		url.search = new URLSearchParams({
			client_id: current.clientId,
			id_token_hint: current.idToken,
			post_logout_redirect_uri: postLogoutRedirectUri,
			...(impersonating ? { state: "impersonation" } : {}),
		}).toString();
		if (!impersonating) {
			yield* clearLocal;
		}
		return url.toString();
	});

	return {
		logout,
		userInfo,
		accessToken,
		authorization,
		rejectAuthorization,
		completeAuthorization,
		clear: (origin) =>
			Effect.all([clearTokens(origin).pipe(Effect.ignore), storage.clearPending(origin)], {
				discard: true,
			}),
	};
};

export class OAuthTokenService extends Context.Service<
	OAuthTokenService,
	{
		readonly authorization: ReturnType<typeof makeAuthorizationState>;
		readonly logout: (
			origin: ServerOrigin,
			postLogoutRedirectUri: string,
		) => Effect.Effect<string | null, OAuthTokenError>;
		readonly clear: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly accessToken: (
			origin: ServerOrigin,
			forceRefresh?: boolean,
		) => Effect.Effect<string | null, OAuthTokenError>;
		readonly userInfo: (
			origin: ServerOrigin,
			authorization: Authorization,
		) => Effect.Effect<
			(OAuthUserInfo & { readonly accessClass: AccessClass }) | null,
			OAuthTokenError
		>;
		readonly rejectAuthorization: (
			origin: ServerOrigin,
			state: string,
		) => Effect.Effect<never, OAuthTokenError>;
		readonly completeAuthorization: (
			origin: ServerOrigin,
			expectedClientIds: readonly PendingAuthorization["clientId"][],
			expectedRedirectUri: string,
			state: string,
			code: string,
		) => Effect.Effect<PendingAuthorization, OAuthTokenError>;
	}
>()("OAuthTokenService") {
	static readonly layer = Layer.effect(
		this,
		Effect.map(OAuthStorage, (storage) => makeTokenService(storage, fetch, Date.now)),
	).pipe(Layer.provide(OAuthStorage.layer));
}

export const oauthTokenServiceLayer = (fetcher: OAuthFetch, now: () => number = Date.now) =>
	Layer.effect(
		OAuthTokenService,
		Effect.map(OAuthStorage, (storage) => makeTokenService(storage, fetcher, now)),
	);
