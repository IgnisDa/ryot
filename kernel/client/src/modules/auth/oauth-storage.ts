import {
	PendingAuthorization,
	type PendingAuthorization as PendingAuthorizationValue,
	StoredTokenSet,
	type StoredTokenSet as StoredTokenSetValue,
} from "@ryot/contract/oauth";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";
import { isNativePlatform } from "#/modules/navigation/native-navigation";

const SECURE_KEY_PREFIX = "ryot_";
const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const OAUTH_PENDING_PREFIX = "ryot:oauth:pending:";
const OAUTH_TOKEN_PREFIX = "ryot:oauth:tokens:";

export class OAuthStorageError extends Data.TaggedError("OAuthStorageError")<{
	readonly reason: "read-failed" | "write-failed";
	readonly cause?: unknown;
}> {}

export type OAuthStorageAdapter = {
	readonly keys: Effect.Effect<readonly string[], OAuthStorageError>;
	readonly removeItem: (key: string) => Effect.Effect<void, OAuthStorageError>;
	readonly getItem: (key: string) => Effect.Effect<string | null, OAuthStorageError>;
	readonly setItem: (key: string, value: string) => Effect.Effect<void, OAuthStorageError>;
};

export const oauthPendingKey = (origin: string, state: string) =>
	`${OAUTH_PENDING_PREFIX}${encodeURIComponent(normalizeServerOrigin(origin))}:${state}`;
export const oauthTokenKey = (origin: ServerOrigin) => `${OAUTH_TOKEN_PREFIX}${origin}`;

const browserOAuthStorage = (): OAuthStorageAdapter => {
	const storage = typeof localStorage === "undefined" ? undefined : localStorage;
	const attempt = <A>(reason: OAuthStorageError["reason"], evaluate: () => A) =>
		Effect.try({ try: evaluate, catch: (cause) => new OAuthStorageError({ reason, cause }) });
	return {
		getItem: (key) => attempt("read-failed", () => storage?.getItem(key) ?? null),
		removeItem: (key) => attempt("write-failed", () => storage?.removeItem(key)),
		setItem: (key, value) => attempt("write-failed", () => storage?.setItem(key, value)),
		keys: attempt("read-failed", () =>
			Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index)).filter(
				(key): key is string => typeof key === "string",
			),
		),
	};
};

const secureOAuthStorage = (): OAuthStorageAdapter => {
	const ready = import("@aparajita/capacitor-secure-storage").then(
		async ({ KeychainAccess, SecureStorage }) => {
			await SecureStorage.setKeyPrefix(SECURE_KEY_PREFIX);
			await SecureStorage.setSynchronize(false);
			await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
			return { plugin: SecureStorage };
		},
	);
	void ready.catch(() => undefined);
	const attempt = <A>(
		reason: OAuthStorageError["reason"],
		operation: (storage: Awaited<typeof ready>["plugin"]) => Promise<A>,
	) =>
		Effect.tryPromise({
			try: () => ready.then(({ plugin }) => operation(plugin)),
			catch: (cause) => new OAuthStorageError({ reason, cause }),
		});
	return {
		keys: attempt("read-failed", (storage) => storage.keys()),
		getItem: (key) => attempt("read-failed", (storage) => storage.getItem(key)),
		removeItem: (key) => attempt("write-failed", (storage) => storage.removeItem(key)),
		setItem: (key, value) => attempt("write-failed", (storage) => storage.setItem(key, value)),
	};
};

const makeStorage = (adapter: OAuthStorageAdapter): OAuthStorage["Service"] => {
	const evict = (key: string) => adapter.removeItem(key).pipe(Effect.catch(() => Effect.void));
	const readUnverified = (key: string) =>
		adapter.getItem(key).pipe(Effect.catch(() => Effect.succeed(undefined)));
	const decodeOrEvict = <A>(schema: Schema.Codec<A, unknown>, key: string, value: string) =>
		Effect.try(() => Schema.decodeUnknownSync(schema)(JSON.parse(value))).pipe(
			Effect.catch(() => Effect.as(evict(key), null)),
		);
	const isFresh = (pending: PendingAuthorizationValue) =>
		Date.now() - pending.createdAt <= PENDING_AUTHORIZATION_TTL_MS;
	const readPending = (key: string) =>
		Effect.gen(function* () {
			const value = yield* readUnverified(key);
			if (value === undefined || value === null) {
				return value;
			}
			return yield* decodeOrEvict(PendingAuthorization, key, value);
		});
	const getPending = (origin: ServerOrigin, state: string) =>
		Effect.gen(function* () {
			const key = oauthPendingKey(origin, state);
			const pending = yield* readPending(key);
			if (pending === undefined || pending === null) {
				return null;
			}
			if (!isFresh(pending)) {
				yield* evict(key);
				return null;
			}
			return pending;
		});
	const prunePending = (origin: string) =>
		Effect.gen(function* () {
			const prefix = `${OAUTH_PENDING_PREFIX}${encodeURIComponent(normalizeServerOrigin(origin))}:`;
			const keys = yield* adapter.keys.pipe(
				Effect.catch(() => Effect.succeed<readonly string[]>([])),
			);
			yield* Effect.forEach(
				keys.filter((key) => key.startsWith(prefix)),
				(key) =>
					Effect.gen(function* () {
						const pending = yield* readPending(key);
						if (pending !== undefined && pending !== null && !isFresh(pending)) {
							yield* evict(key);
						}
					}),
				{ discard: true },
			);
		});
	return {
		getPending,
		removeTokenSet: (origin) => adapter.removeItem(oauthTokenKey(origin)),
		removePending: (origin, state) => evict(oauthPendingKey(origin, state)),
		setTokenSet: (origin, tokenSet) =>
			adapter.setItem(oauthTokenKey(origin), JSON.stringify(tokenSet)),
		setPending: (pending) =>
			Effect.gen(function* () {
				yield* prunePending(pending.serverOrigin);
				yield* adapter.setItem(
					oauthPendingKey(pending.serverOrigin, pending.state),
					JSON.stringify(pending),
				);
			}),
		getTokenSet: (origin) =>
			Effect.gen(function* () {
				const key = oauthTokenKey(origin);
				const value = yield* readUnverified(key);
				if (value === undefined || value === null) {
					return null;
				}
				return yield* decodeOrEvict(StoredTokenSet, key, value);
			}),
		takePending: (origin, state) =>
			Effect.gen(function* () {
				const pending = yield* getPending(origin, state);
				if (pending === null) {
					return null;
				}
				yield* evict(oauthPendingKey(origin, state));
				return pending;
			}),
		clearPending: (origin) =>
			Effect.gen(function* () {
				const prefix = `${OAUTH_PENDING_PREFIX}${encodeURIComponent(origin)}:`;
				const keys = yield* adapter.keys.pipe(
					Effect.catch(() => Effect.succeed<readonly string[]>([])),
				);
				yield* Effect.forEach(
					keys.filter((key) => key.startsWith(prefix)),
					evict,
					{ discard: true },
				);
			}),
	};
};

export class OAuthStorage extends Context.Service<
	OAuthStorage,
	{
		readonly removePending: (origin: ServerOrigin, state: string) => Effect.Effect<void>;
		readonly clearPending: (origin: ServerOrigin) => Effect.Effect<void>;
		readonly removeTokenSet: (origin: ServerOrigin) => Effect.Effect<void, OAuthStorageError>;
		readonly getTokenSet: (origin: ServerOrigin) => Effect.Effect<StoredTokenSetValue | null>;
		readonly setPending: (
			pending: PendingAuthorizationValue,
		) => Effect.Effect<void, OAuthStorageError>;
		readonly getPending: (
			origin: ServerOrigin,
			state: string,
		) => Effect.Effect<PendingAuthorizationValue | null>;
		readonly takePending: (
			origin: ServerOrigin,
			state: string,
		) => Effect.Effect<PendingAuthorizationValue | null>;
		readonly setTokenSet: (
			origin: ServerOrigin,
			tokenSet: StoredTokenSetValue,
		) => Effect.Effect<void, OAuthStorageError>;
	}
>()("OAuthStorage") {
	static readonly layer = Layer.sync(this, () =>
		makeStorage(isNativePlatform() ? secureOAuthStorage() : browserOAuthStorage()),
	);
}

export const oauthStorageLayer = (adapter: OAuthStorageAdapter) =>
	Layer.succeed(OAuthStorage, makeStorage(adapter));
