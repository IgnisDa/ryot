import { describe, expect, it } from "@effect/vitest";
import { OAUTH_WEB_CLIENT_ID } from "@ryot/contract/oauth";
import { Effect } from "effect";

import {
	OAuthStorage,
	oauthPendingKey,
	oauthStorageLayer,
	oauthTokenKey,
	type OAuthBrowserStorage,
} from "#/modules/auth/oauth-storage";

const makeStorage = () => {
	const values = new Map<string, string>();
	const storage: OAuthBrowserStorage = {
		removeItem: (key) => values.delete(key),
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		key: (index) => [...values.keys()][index] ?? null,
		get length() {
			return values.size;
		},
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

			expect(yield* service.getPending("https://ryot.example/", "state")).toEqual(pending);
			expect(yield* service.getTokenSet("https://ryot.example")).toEqual(tokens);
			expect(yield* service.takePending("https://ryot.example", "state")).toEqual(pending);
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
			expect(yield* service.getPending("https://ryot.example", "expired")).toBeNull();
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
});
