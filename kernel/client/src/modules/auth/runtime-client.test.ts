import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { makeRuntimeOAuthClient } from "#/modules/auth/runtime-client";

const origin = decodeServerOrigin("https://ryot.example");

describe("runtime OAuth client", () => {
	it("describes the web client from the server origin", async () => {
		const client = makeRuntimeOAuthClient({
			isNative: () => false,
			getApplicationId: () => Promise.reject(new Error("not used")),
		});

		await expect(Effect.runPromise(client.forServer(origin))).resolves.toEqual({
			clientId: "ryot-web",
			nativeApplicationId: null,
			callbackUri: "https://ryot.example/auth/callback",
			logoutUri: "https://ryot.example/auth/logout/callback",
		});
	});

	it.each(["io.ryot.app", "io.ryot.app.dev"])(
		"describes the validated native client for %s",
		async (applicationId) => {
			const client = makeRuntimeOAuthClient({
				isNative: () => true,
				getApplicationId: () => Promise.resolve(applicationId),
			});

			await expect(Effect.runPromise(client.forServer(origin))).resolves.toEqual({
				clientId: "ryot-native",
				nativeApplicationId: applicationId,
				callbackUri: `${applicationId}:/auth/callback`,
				logoutUri: `${applicationId}:/auth/logout/callback`,
			});
		},
	);

	it.each([
		() => Promise.resolve("io.ryot.unknown"),
		() => Promise.reject(new Error("unavailable")),
	])("rejects an unreadable or unknown native application", async (getApplicationId) => {
		const client = makeRuntimeOAuthClient({ isNative: () => true, getApplicationId });

		await expect(Effect.runPromise(client.forServer(origin))).rejects.toMatchObject({
			_tag: "RuntimeOAuthClientError",
		});
	});

	it("reads the native application ID once", async () => {
		let calls = 0;
		const client = makeRuntimeOAuthClient({
			isNative: () => true,
			getApplicationId: () => {
				calls += 1;
				return Promise.resolve("io.ryot.app");
			},
		});

		await Effect.runPromise(Effect.all([client.forServer(origin), client.forServer(origin)]));
		expect(calls).toBe(1);
	});
});
