import { describe, expect, layer } from "@effect/vitest";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeServerOrigin } from "#/api/origin";
import {
	oauthPendingKey,
	OAuthStorage,
	OAuthStorageError,
	oauthTokenKey,
} from "#/modules/auth/oauth-storage";
import {
	FakeOAuthStorage,
	fakeOAuthStorageLayer,
	makePendingAuthorization,
	makeStoredTokenSet,
} from "#/modules/auth/oauth-storage.test-support";

const origin = decodeServerOrigin("https://ryot.example");
const equivalentOrigin = decodeServerOrigin("https://ryot.example/");

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

describe("OAuth storage", () => {
	layer(fakeOAuthStorageLayer())((test) => {
		test.effect("persists validated pending authorizations and token sets", () =>
			Effect.gen(function* () {
				const service = yield* OAuthStorage;
				const pending = makePendingAuthorization("https://ryot.example", {
					destination: "/library",
					createdAt: yield* Clock.currentTimeMillis,
				});
				const tokens = makeStoredTokenSet();
				yield* service.setPending(pending);
				yield* service.setTokenSet(equivalentOrigin, tokens);

				expect(yield* service.getTokenSet(origin)).toEqual(tokens);
				expect(yield* service.takePending(equivalentOrigin, "state")).toEqual(pending);
				expect(yield* service.takePending(origin, "state")).toBeNull();
			}),
		);
	});

	layer(fakeOAuthStorageLayer())((test) => {
		test.effect("removes malformed, old, and expired records", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(
					oauthTokenKey(origin),
					yield* encodeJson({
						idToken: "id",
						scope: "openid",
						tokenType: "Bearer",
						accessToken: "access",
						refreshToken: "refresh",
						accessTokenExpiresAt: 123,
					}),
				);
				yield* storage.seed(
					oauthPendingKey("https://ryot.example", "expired"),
					yield* encodeJson(
						makePendingAuthorization("https://ryot.example", { createdAt: 0, state: "expired" }),
					),
				);

				yield* TestClock.adjust("20 minutes");
				const service = yield* OAuthStorage;
				expect(yield* service.getTokenSet(origin)).toBeNull();
				expect(yield* service.takePending(origin, "expired")).toBeNull();
				expect((yield* storage.values).size).toBe(0);
			}),
		);
	});

	layer(fakeOAuthStorageLayer())((test) => {
		test.effect("clears only pending authorizations for the selected server", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(oauthPendingKey("https://ryot.example", "one"), "{}");
				yield* storage.seed(oauthPendingKey("https://other.example", "two"), "{}");
				yield* storage.seed(oauthTokenKey(origin), "{}");
				const service = yield* OAuthStorage;
				yield* service.clearPending(origin);
				expect([...(yield* storage.values).keys()]).toEqual([
					oauthPendingKey("https://other.example", "two"),
					oauthTokenKey(origin),
				]);
			}),
		);
	});

	layer(fakeOAuthStorageLayer())((test) => {
		test.effect("prunes abandoned pending authorizations before creating another", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				const fresh = makePendingAuthorization("https://ryot.example", {
					state: "fresh",
					createdAt: 20 * 60 * 1000,
				});
				const otherOrigin = { ...fresh, state: "other", serverOrigin: "https://other.example" };
				yield* storage.seed(oauthPendingKey(origin, fresh.state), yield* encodeJson(fresh));
				yield* storage.seed(
					oauthPendingKey(origin, "expired"),
					yield* encodeJson({ ...fresh, createdAt: 0, state: "expired" }),
				);
				yield* storage.seed(oauthPendingKey(origin, "malformed"), "not-json");
				yield* storage.seed(
					oauthPendingKey(otherOrigin.serverOrigin, otherOrigin.state),
					yield* encodeJson(otherOrigin),
				);

				yield* TestClock.adjust("20 minutes");
				const service = yield* OAuthStorage;
				yield* service.setPending({ ...fresh, state: "new" });

				expect([...(yield* storage.values).keys()]).toEqual([
					oauthPendingKey(origin, "fresh"),
					oauthPendingKey(otherOrigin.serverOrigin, "other"),
					oauthPendingKey(origin, "new"),
				]);
			}),
		);
	});

	layer(
		fakeOAuthStorageLayer({
			getItem: () => Effect.fail(new OAuthStorageError({ reason: "read-failed" })),
		}),
	)((test) => {
		test.effect("keeps records that cannot be read", () =>
			Effect.gen(function* () {
				const storage = yield* FakeOAuthStorage;
				yield* storage.seed(oauthTokenKey(origin), "{}");
				yield* storage.seed(oauthPendingKey("https://ryot.example", "state"), "{}");
				const service = yield* OAuthStorage;
				expect(yield* service.getTokenSet(origin)).toBeNull();
				expect(yield* service.takePending(origin, "state")).toBeNull();
				expect((yield* storage.values).size).toBe(2);
			}),
		);
	});

	layer(
		fakeOAuthStorageLayer({
			setItem: () => Effect.fail(new OAuthStorageError({ reason: "write-failed" })),
		}),
	)((test) => {
		test.effect("fails when a record cannot be written", () =>
			Effect.gen(function* () {
				const service = yield* OAuthStorage;
				const failure = yield* Effect.flip(service.setTokenSet(origin, makeStoredTokenSet()));
				expect(failure.reason).toBe("write-failed");
			}),
		);
	});
});
