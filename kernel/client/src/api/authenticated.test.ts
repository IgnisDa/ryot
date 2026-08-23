import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeAuthenticatedApi } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeRuntimeOAuthClient } from "#/modules/auth/runtime-client";
import type { OAuthTokenService } from "#/modules/auth/token-service";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const runtimeClient = (isNative: boolean) =>
	makeRuntimeOAuthClient({
		isNative: () => isNative,
		getApplicationId: () => Promise.resolve("io.ryot.app"),
	});

const tokens = (
	accessToken: OAuthTokenService["Service"]["accessToken"],
): OAuthTokenService["Service"] => ({
	accessToken,
	clear: () => Effect.void,
	logout: () => Effect.succeed(null),
	userInfo: () => Effect.succeed(null),
	rejectAuthorization: () => Effect.die("not used"),
	completeAuthorization: () => Effect.die("not used"),
});

describe("authenticated API", () => {
	it("retries one authentication failure after forcing a refresh", async () => {
		const forceRefresh: boolean[] = [];
		const clientIds: string[] = [];
		let attempts = 0;
		const api = makeAuthenticatedApi(
			tokens((_origin, clientId, force = false) => {
				clientIds.push(clientId);
				forceRefresh.push(force);
				return Effect.succeed(force ? "fresh" : "stale");
			}),
			runtimeClient(false),
		);

		await expect(
			Effect.runPromise(
				api.run(scope, () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
						: Effect.succeed("completed");
				}),
			),
		).resolves.toBe("completed");
		expect(forceRefresh).toEqual([false, true]);
		expect(clientIds).toEqual(["ryot-web", "ryot-web"]);
		expect(attempts).toBe(2);
	});

	it("does not retry a non-authentication failure", async () => {
		const api = makeAuthenticatedApi(
			tokens(() => Effect.succeed("token")),
			runtimeClient(false),
		);
		let attempts = 0;

		await expect(
			Effect.runPromise(
				api.run(scope, () => {
					attempts += 1;
					return Effect.fail(new TypeError("offline"));
				}),
			),
		).rejects.toBeDefined();
		expect(attempts).toBe(1);
	});

	it("uses the native OAuth client for an installed application", async () => {
		const clientIds: string[] = [];
		const api = makeAuthenticatedApi(
			tokens((_origin, clientId) => {
				clientIds.push(clientId);
				return Effect.succeed("token");
			}),
			runtimeClient(true),
		);

		await Effect.runPromise(api.run(scope, () => Effect.succeed("completed")));
		expect(clientIds).toEqual(["ryot-native"]);
	});
});
