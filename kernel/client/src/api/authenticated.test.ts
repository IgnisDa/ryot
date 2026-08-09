import { AuthUnauthorized } from "@ryot/contract/auth-middleware";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeAuthenticatedApi } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { OAuthTokenService } from "#/modules/auth/token-service";

const scope = { serverUrl: decodeServerOrigin("https://ryot.example"), userId: "user-1" };

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
		let attempts = 0;
		const api = makeAuthenticatedApi(
			tokens((_origin, _clientId, force = false) => {
				forceRefresh.push(force);
				return Effect.succeed(force ? "fresh" : "stale");
			}),
			() => false,
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
		expect(attempts).toBe(2);
	});

	it("does not retry a non-authentication failure", async () => {
		const api = makeAuthenticatedApi(
			tokens(() => Effect.succeed("token")),
			() => false,
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
});
