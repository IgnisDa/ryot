import {
	PendingAuthorization,
	type PendingAuthorization as PendingAuthorizationValue,
	StoredTokenSet,
	type StoredTokenSet as StoredTokenSetValue,
} from "@ryot/contract/oauth";
import { Context, Effect, Layer, Schema } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";

const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const OAUTH_PENDING_PREFIX = "ryot:oauth:pending:";
const OAUTH_TOKEN_PREFIX = "ryot:oauth:tokens:";

export type OAuthBrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export const oauthPendingKey = (state: string) => `${OAUTH_PENDING_PREFIX}${state}`;
export const oauthTokenKey = (origin: ServerOrigin) =>
	`${OAUTH_TOKEN_PREFIX}${normalizeServerOrigin(origin)}`;

const decodeStored = <A>(schema: Schema.Codec<A, unknown>, value: string | null) => {
	if (value === null) {
		return null;
	}
	return Schema.decodeUnknownSync(schema)(JSON.parse(value));
};

const makeStorage = (storage: OAuthBrowserStorage | undefined): OAuthStorage["Service"] => ({
	setPending: (pending) =>
		Effect.sync(() => storage?.setItem(oauthPendingKey(pending.state), JSON.stringify(pending))),
	setTokenSet: (origin, tokenSet) =>
		Effect.sync(() => storage?.setItem(oauthTokenKey(origin), JSON.stringify(tokenSet))),
	getTokenSet: (origin) =>
		Effect.sync(() => {
			const key = oauthTokenKey(origin);
			try {
				return decodeStored(StoredTokenSet, storage?.getItem(key) ?? null);
			} catch {
				storage?.removeItem(key);
				return null;
			}
		}),
	getPending: (state) =>
		Effect.sync(() => {
			const key = oauthPendingKey(state);
			try {
				const pending = decodeStored(PendingAuthorization, storage?.getItem(key) ?? null);
				if (pending && Date.now() - pending.createdAt <= PENDING_AUTHORIZATION_TTL_MS) {
					return pending;
				}
				storage?.removeItem(key);
				return null;
			} catch {
				storage?.removeItem(key);
				return null;
			}
		}),
});

export class OAuthStorage extends Context.Service<
	OAuthStorage,
	{
		readonly setPending: (pending: PendingAuthorizationValue) => Effect.Effect<void>;
		readonly getPending: (state: string) => Effect.Effect<PendingAuthorizationValue | null>;
		readonly getTokenSet: (origin: ServerOrigin) => Effect.Effect<StoredTokenSetValue | null>;
		readonly setTokenSet: (
			origin: ServerOrigin,
			tokenSet: StoredTokenSetValue,
		) => Effect.Effect<void>;
	}
>()("OAuthStorage") {
	// TODO: Replace native localStorage with Keychain/Keystore-backed storage.
	static readonly layer = Layer.succeed(
		this,
		makeStorage(typeof localStorage === "undefined" ? undefined : localStorage),
	);
}

export const oauthStorageLayer = (storage: OAuthBrowserStorage | undefined) =>
	Layer.succeed(OAuthStorage, makeStorage(storage));
