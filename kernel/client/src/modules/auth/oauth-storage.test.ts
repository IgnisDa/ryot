import { describe, expect, it } from "@effect/vitest";
import { OAUTH_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	OAuthStorage,
	OAuthStorageError,
	oauthPendingKey,
	oauthStorageLayer,
	oauthTokenKey,
	type OAuthStorageAdapter,
} from "#/modules/auth/oauth-storage";

const origin = decodeServerOrigin("https://ryot.example");
const equivalentOrigin = decodeServerOrigin("https://ryot.example/");

const makeStorage = (overrides: Partial<OAuthStorageAdapter> = {}) => {
	const values = new Map<string, string>();
	const storage: OAuthStorageAdapter = {
		keys: Effect.sync(() => [...values.keys()]),
		getItem: (key) => Effect.sync(() => values.get(key) ?? null),
		removeItem: (key) => Effect.sync(() => void values.delete(key)),
		setItem: (key, value) => Effect.sync(() => void values.set(key, value)),
		...overrides,
	};
	return { values, storage };
};

describe("OAuth storage", () => {
	it.effect("persists validated pending authorizations and token sets", () => {
		const { storage } = makeStorage();
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			const pending = {
				state: "state",
				nonce: "nonce",
				createdAt: Date.now(),
				destination: "/library",
				codeVerifier: "verifier",
				clientId: OAUTH_WEB_CLIENT_ID,
				serverOrigin: "https://ryot.example",
				redirectUri: "https://ryot.example/auth/callback",
			} as const;
			const tokens = {
				idToken: "id",
				scope: "openid",
				tokenType: "Bearer",
				accessToken: "access",
				refreshToken: "refresh",
				accessTokenExpiresAt: 123,
			};
			yield* service.setPending(pending);
			yield* service.setTokenSet(equivalentOrigin, tokens);

			expect(yield* service.getTokenSet(origin)).toEqual(tokens);
			expect(yield* service.takePending(equivalentOrigin, "state")).toEqual(pending);
			expect(yield* service.takePending(origin, "state")).toBeNull();
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("removes malformed and expired records", () => {
		const { values, storage } = makeStorage();
		values.set(oauthTokenKey(origin), "not-json");
		values.set(
			oauthPendingKey("https://ryot.example", "expired"),
			JSON.stringify({
				createdAt: 0,
				nonce: "nonce",
				state: "expired",
				destination: "/",
				codeVerifier: "verifier",
				clientId: OAUTH_WEB_CLIENT_ID,
				serverOrigin: "https://ryot.example",
				redirectUri: "https://ryot.example/auth/callback",
			}),
		);

		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			expect(yield* service.getTokenSet(origin)).toBeNull();
			expect(yield* service.takePending(origin, "expired")).toBeNull();
			expect(values.size).toBe(0);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("clears only pending authorizations for the selected server", () => {
		const { values, storage } = makeStorage();
		values.set(oauthPendingKey("https://ryot.example", "one"), "{}");
		values.set(oauthPendingKey("https://other.example", "two"), "{}");
		values.set(oauthTokenKey(origin), "{}");
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			yield* service.clearPending(origin);
			expect([...values.keys()]).toEqual([
				oauthPendingKey("https://other.example", "two"),
				oauthTokenKey(origin),
			]);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("prunes abandoned pending authorizations before creating another", () => {
		const { values, storage } = makeStorage();
		const fresh = {
			nonce: "nonce",
			state: "fresh",
			destination: "/",
			createdAt: Date.now(),
			codeVerifier: "verifier",
			clientId: OAUTH_WEB_CLIENT_ID,
			serverOrigin: "https://ryot.example",
			redirectUri: "https://ryot.example/auth/callback",
		} as const;
		const otherOrigin = { ...fresh, state: "other", serverOrigin: "https://other.example" };
		values.set(oauthPendingKey(origin, fresh.state), JSON.stringify(fresh));
		values.set(
			oauthPendingKey(origin, "expired"),
			JSON.stringify({ ...fresh, createdAt: 0, state: "expired" }),
		);
		values.set(oauthPendingKey(origin, "malformed"), "not-json");
		values.set(
			oauthPendingKey(otherOrigin.serverOrigin, otherOrigin.state),
			JSON.stringify(otherOrigin),
		);

		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			yield* service.setPending({ ...fresh, state: "new" });

			expect([...values.keys()]).toEqual([
				oauthPendingKey(origin, "fresh"),
				oauthPendingKey(otherOrigin.serverOrigin, "other"),
				oauthPendingKey(origin, "new"),
			]);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("keeps records that cannot be read", () => {
		const { values, storage } = makeStorage({
			getItem: () => Effect.fail(new OAuthStorageError({ reason: "read-failed" })),
		});
		values.set(oauthTokenKey(origin), "{}");
		values.set(oauthPendingKey("https://ryot.example", "state"), "{}");
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			expect(yield* service.getTokenSet(origin)).toBeNull();
			expect(yield* service.takePending(origin, "state")).toBeNull();
			expect(values.size).toBe(2);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("fails when a record cannot be written", () => {
		const { storage } = makeStorage({
			setItem: () => Effect.fail(new OAuthStorageError({ reason: "write-failed" })),
		});
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			const failure = yield* Effect.flip(
				service.setTokenSet(origin, {
					idToken: "id",
					scope: "openid",
					tokenType: "Bearer",
					accessToken: "access",
					refreshToken: "refresh",
					accessTokenExpiresAt: 123,
				}),
			);
			expect(failure.reason).toBe("write-failed");
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});
});
