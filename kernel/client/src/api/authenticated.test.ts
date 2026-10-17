import { describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { Effect } from "effect";
import { HttpClient } from "effect/http";

import {
	AuthenticatedApiError,
	isDemoOperationProtectedError,
	makeAuthenticatedApi,
} from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { OAuthTokenService } from "#/modules/auth/token-service";
import { makeOAuthTokenServiceStub } from "#/modules/auth/token-service.test-layer";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const unusedHttp = HttpClient.make(() => Effect.die("not used"));
const bearerToken = (sub: string) =>
	`header.${btoa(JSON.stringify({ sub })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;
const tokens = (accessToken: OAuthTokenService["Service"]["accessToken"]) =>
	makeOAuthTokenServiceStub({ accessToken });

describe("authenticated API", () => {
	it.live("retries one authentication failure after forcing a refresh", () =>
		Effect.gen(function* () {
			const forceRefresh: boolean[] = [];
			let attempts = 0;
			const api = makeAuthenticatedApi(
				tokens((_origin, force = false) => {
					forceRefresh.push(force);
					return Effect.succeed(bearerToken("user-1"));
				}),
				unusedHttp,
			);

			expect(
				yield* api.run(scope, () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
						: Effect.succeed("completed");
				}),
			).toBe("completed");
			expect(forceRefresh).toEqual([false, true]);
			expect(attempts).toBe(2);
		}),
	);

	it.live("does not retry a non-authentication failure", () =>
		Effect.gen(function* () {
			const api = makeAuthenticatedApi(
				tokens(() => Effect.succeed(bearerToken("user-1"))),
				unusedHttp,
			);
			let attempts = 0;

			expect(
				yield* Effect.flip(
					api.run(scope, () => {
						attempts += 1;
						return Effect.fail(new AuthenticatedApiError({ cause: "offline" }));
					}),
				),
			).toBeDefined();
			expect(attempts).toBe(1);
		}),
	);

	it.live("preserves a demo operation failure without forcing a token refresh", () =>
		Effect.gen(function* () {
			const forceRefresh: boolean[] = [];
			let attempts = 0;
			const protectedOperation = new DemoOperationProtected({
				reason: { code: "demo-operation-protected" },
			});
			const api = makeAuthenticatedApi(
				tokens((_origin, force = false) => {
					forceRefresh.push(force);
					return Effect.succeed(bearerToken("user-1"));
				}),
				unusedHttp,
			);

			const error = yield* Effect.flip(
				api.run(scope, () => {
					attempts += 1;
					return Effect.fail(protectedOperation);
				}),
			);

			expect(forceRefresh).toEqual([false]);
			expect(attempts).toBe(1);
			expect(isDemoOperationProtectedError(error)).toBe(true);
			if (isDemoOperationProtectedError(error)) {
				expect(error.cause).toBe(protectedOperation);
			}
		}),
	);

	it.live("does not infer the stored token client from the runtime platform", () =>
		Effect.gen(function* () {
			const calls: boolean[] = [];
			const api = makeAuthenticatedApi(
				tokens((_origin, _clientId, force = false) => {
					calls.push(force);
					return Effect.succeed(bearerToken("user-1"));
				}),
				unusedHttp,
			);

			yield* api.run(scope, () => Effect.succeed("completed"));
			expect(calls).toEqual([false]);
		}),
	);

	it.live("refuses a token for a different user scope before running the API program", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const api = makeAuthenticatedApi(
				tokens(() => Effect.succeed(bearerToken("user-2"))),
				unusedHttp,
			);

			const failure = yield* Effect.flip(
				api.run(scope, () => {
					attempts += 1;
					return Effect.succeed("completed");
				}),
			);

			expect(failure).toMatchObject({ _tag: "AuthenticatedApiError" });
			expect(attempts).toBe(0);
		}),
	);
});
