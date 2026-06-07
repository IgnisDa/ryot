import { describe, expect, it } from "@effect/vitest";
import { OAUTH_WEB_CLIENT_ID } from "@ryot/contract/oauth";
import { Effect } from "effect";

import {
	OAuthStorage,
	OAuthStorageError,
	oauthPendingKey,
	oauthStorageLayer,
	oauthTokenKey,
	type OAuthStorageAdapter,
} from "#/modules/auth/oauth-storage";

const makeStorage = (overrides: Partial<OAuthStorageAdapter> = {}) => {
	const values = new Map<string, string>();
	const storage: OAuthStorageAdapter = {
		keys: Effect.sync(() => [...values.keys()]),
		getItem: (key) => Effect.sync(() => values.get(key) ?? null),
		removeItem: (key) => Effect.sync(() => void values.delete(key)),
		setItem: (key, value) => Effect.sync(() => void values.set(key, value)),
		...overrides,
	};
	return { storage, values };
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
			yield* service.setTokenSet("https://ryot.example/", tokens);

			expect(yield* service.getTokenSet("https://ryot.example")).toEqual(tokens);
			expect(yield* service.takePending("https://ryot.example/", "state")).toEqual(pending);
			expect(yield* service.takePending("https://ryot.example", "state")).toBeNull();
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("removes malformed and expired records", () => {
		const { storage, values } = makeStorage();
		values.set(oauthTokenKey("https://ryot.example"), "not-json");
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
			expect(yield* service.getTokenSet("https://ryot.example")).toBeNull();
			expect(yield* service.takePending("https://ryot.example", "expired")).toBeNull();
			expect(values.size).toBe(0);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("clears only pending authorizations for the selected server", () => {
		const { storage, values } = makeStorage();
		values.set(oauthPendingKey("https://ryot.example", "one"), "{}");
		values.set(oauthPendingKey("https://other.example", "two"), "{}");
		values.set(oauthTokenKey("https://ryot.example"), "{}");
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			yield* service.clearPending("https://ryot.example");
			expect([...values.keys()]).toEqual([
				oauthPendingKey("https://other.example", "two"),
				oauthTokenKey("https://ryot.example"),
			]);
		}).pipe(Effect.provide(oauthStorageLayer(storage)));
	});

	it.effect("keeps records that cannot be read", () => {
		const { storage, values } = makeStorage({
			getItem: () => Effect.fail(new OAuthStorageError({ reason: "read-failed" })),
		});
		values.set(oauthTokenKey("https://ryot.example"), "{}");
		values.set(oauthPendingKey("https://ryot.example", "state"), "{}");
		return Effect.gen(function* () {
			const service = yield* OAuthStorage;
			expect(yield* service.getTokenSet("https://ryot.example")).toBeNull();
			expect(yield* service.takePending("https://ryot.example", "state")).toBeNull();
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
				service.setTokenSet("https://ryot.example", {
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
