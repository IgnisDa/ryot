import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { isDemoOperationProtectedError, makeAuthenticatedApi } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { OAuthTokenService } from "#/modules/auth/token-service";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
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
			tokens((_origin, force = false) => {
				forceRefresh.push(force);
				return Effect.succeed(force ? "fresh" : "stale");
			}),
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
		const api = makeAuthenticatedApi(tokens(() => Effect.succeed("token")));
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

	it("preserves a demo operation failure without forcing a token refresh", async () => {
		const forceRefresh: boolean[] = [];
		let attempts = 0;
		const protectedOperation = new DemoOperationProtected({
			reason: { code: "demo-operation-protected" },
		});
		const api = makeAuthenticatedApi(
			tokens((_origin, force = false) => {
				forceRefresh.push(force);
				return Effect.succeed("token");
			}),
		);

		const error = await Effect.runPromise(
			Effect.flip(
				api.run(scope, () => {
					attempts += 1;
					return Effect.fail(protectedOperation);
				}),
			),
		);

		expect(forceRefresh).toEqual([false]);
		expect(attempts).toBe(1);
		expect(isDemoOperationProtectedError(error)).toBe(true);
		if (isDemoOperationProtectedError(error)) {
			expect(error.cause).toBe(protectedOperation);
		}
	});

	it("does not infer the stored token client from the runtime platform", async () => {
		const calls: boolean[] = [];
		const api = makeAuthenticatedApi(
			tokens((_origin, _clientId, force = false) => {
				calls.push(force);
				return Effect.succeed("token");
			}),
		);

		await Effect.runPromise(api.run(scope, () => Effect.succeed("completed")));
		expect(calls).toEqual([false]);
	});
});
