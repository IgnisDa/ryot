import {
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
	type StoredTokenSet,
} from "@ryot-app/contract/oauth";
import { Context, Effect, Layer, Ref } from "effect";

import { type OAuthStorageAdapter, oauthStorageLayer } from "#/modules/auth/oauth-storage";

export class FakeOAuthStorage extends Context.Service<
	FakeOAuthStorage,
	{
		readonly values: Effect.Effect<ReadonlyMap<string, string>>;
		readonly seed: (key: string, value: string) => Effect.Effect<void>;
	}
>()("test/FakeOAuthStorage") {}

export const fakeOAuthStorageLayer = (overrides: Partial<OAuthStorageAdapter> = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const values = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
			const setItem = (key: string, value: string) =>
				Ref.update(values, (current) => new Map(current).set(key, value));
			const adapter: OAuthStorageAdapter = {
				setItem,
				keys: Effect.map(Ref.get(values), (current) => [...current.keys()]),
				getItem: (key) => Effect.map(Ref.get(values), (current) => current.get(key) ?? null),
				removeItem: (key) =>
					Ref.update(values, (current) => {
						const next = new Map(current);
						next.delete(key);
						return next;
					}),
				...overrides,
			};
			return Layer.merge(
				oauthStorageLayer(adapter),
				Layer.succeed(FakeOAuthStorage, { seed: setItem, values: Ref.get(values) }),
			);
		}),
	);

export const makePendingAuthorization = (
	serverOrigin: string,
	overrides: Partial<PendingAuthorization> = {},
): PendingAuthorization => ({
	serverOrigin,
	createdAt: 1,
	state: "state",
	nonce: "nonce",
	destination: "/",
	codeVerifier: "verifier",
	clientId: OAUTH_WEB_CLIENT_ID,
	redirectUri: `${serverOrigin}/auth/callback`,
	...overrides,
});

export const makeStoredTokenSet = (overrides: Partial<StoredTokenSet> = {}): StoredTokenSet => ({
	idToken: "id",
	scope: "openid",
	tokenType: "Bearer",
	accessToken: "access",
	refreshToken: "refresh",
	accessTokenExpiresAt: 123,
	clientId: OAUTH_WEB_CLIENT_ID,
	...overrides,
});
