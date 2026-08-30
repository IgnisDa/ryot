import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { makeRuntimeOAuthClient } from "#/modules/auth/runtime-client";

const origin = decodeServerOrigin("https://ryot.example");

describe("runtime OAuth client", () => {
	it.live("describes the web client from the server origin", () =>
		Effect.gen(function* () {
			const client = makeRuntimeOAuthClient({
				isNative: () => false,
				getApplicationId: () => Promise.reject(new Error("not used")),
			});

			expect(yield* client.forServer(origin)).toEqual({
				clientId: "ryot-web",
				nativeApplicationId: null,
				callbackUri: "https://ryot.example/auth/callback",
				logoutUri: "https://ryot.example/auth/logout/callback",
			});
		}),
	);

	it.live.each(["io.ryot.app", "io.ryot.app.dev"])(
		"describes the validated native client for %s",
		(applicationId) =>
			Effect.gen(function* () {
				const client = makeRuntimeOAuthClient({
					isNative: () => true,
					getApplicationId: () => Promise.resolve(applicationId),
				});

				expect(yield* client.forServer(origin)).toEqual({
					clientId: "ryot-native",
					nativeApplicationId: applicationId,
					callbackUri: `${applicationId}:/auth/callback`,
					logoutUri: `${applicationId}:/auth/logout/callback`,
				});
			}),
	);

	it.live.each([
		() => Promise.resolve("io.ryot.unknown"),
		() => Promise.reject(new Error("unavailable")),
	])("rejects an unreadable or unknown native application", (getApplicationId) =>
		Effect.gen(function* () {
			const client = makeRuntimeOAuthClient({ getApplicationId, isNative: () => true });

			expect(yield* Effect.flip(client.forServer(origin))).toMatchObject({
				_tag: "RuntimeOAuthClientError",
			});
		}),
	);

	it.live("reads the native application ID once", () =>
		Effect.gen(function* () {
			let calls = 0;
			const client = makeRuntimeOAuthClient({
				isNative: () => true,
				getApplicationId: () => {
					calls += 1;
					return Promise.resolve("io.ryot.app");
				},
			});

			yield* Effect.all([client.forServer(origin), client.forServer(origin)]);
			expect(calls).toBe(1);
		}),
	);
});
