import { expect, it } from "@effect/vitest";
import { AuthRateLimited, CurrentUser } from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { isLifecycleProtectedAuthPath, makeAuthMiddleware, resolveCurrentUser } from "./service";

it("gates Better Auth user-owned mutations without blocking unrelated auth routes", () => {
	expect(isLifecycleProtectedAuthPath("/api-key/create")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/update-user")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/sign-in/email")).toBe(false);
	expect(isLifecycleProtectedAuthPath("/get-session")).toBe(false);
});

it.effect("rejects a stale cached session when the authoritative user is disabled", () => {
	let foundUserId: string | null = null;
	let disabledCookieCache = false;
	const headers = new Headers({ cookie: "better-auth.session_token=stale" });
	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			resolveCurrentUser(
				headers,
				(options) => {
					disabledCookieCache = options.query.disableCookieCache;
					return Promise.resolve({ user: { id: "user-1" } });
				},
				(userId) => {
					foundUserId = userId;
					return Effect.succeed({
						image: null,
						name: "User",
						id: "user-1",
						email: "user@example.com",
						disabledAt: new Date("2026-08-24T00:00:00.000Z"),
						preferences: { allowNsfw: false, language: null, disableIntegrations: false },
					});
				},
			),
		);
		expect(error).toMatchObject({
			_tag: "AuthUnauthorized",
			reason: { code: "authentication-required" },
		});
		expect(foundUserId).toBe("user-1");
		expect(disabledCookieCache).toBe(true);
	});
});

it.effect("returns safe rate-limit metadata from session validation", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			resolveCurrentUser(
				new Headers(),
				() => Promise.reject({ body: { code: "RATE_LIMITED", details: { tryAgainIn: 1_250 } } }),
				() => Effect.die("unused"),
			),
		);
		expect(error).toEqual(
			new AuthRateLimited({ reason: { code: "session-rate-limited", retryAfterMs: 1_250 } }),
		);
	}),
);

it.effect("passes complete request headers to the auth service", () => {
	let capturedCookie: string | null = null;
	const middleware = makeAuthMiddleware(
		{
			currentUser: (headers) => {
				capturedCookie = headers.get("cookie");
				return Effect.succeed({
					image: null,
					name: "User",
					email: "user@example.com",
					id: UserId.make("user-1"),
					preferences: { allowNsfw: false, language: null, disableIntegrations: false },
				});
			},
		},
		{ isActive: () => Effect.succeed(false) },
	);
	const routes = HttpRouter.add(
		"GET",
		"/",
		middleware(
			Effect.gen(function* () {
				yield* CurrentUser;
				return HttpServerResponse.empty();
			}),
		),
	);

	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.promise(() =>
				handler(
					new Request("http://localhost/", {
						headers: { cookie: "future-auth-cookie=value" },
					}),
				),
			).pipe(
				Effect.tap((response) =>
					Effect.sync(() => {
						expect(response.status).toBe(204);
						expect(capturedCookie).toBe("future-auth-cookie=value");
					}),
				),
			),
		({ dispose }) => Effect.promise(dispose),
	);
});

it.effect("rejects authenticated writes while a lifecycle operation is active", () => {
	let handlerCalled = false;
	const middleware = makeAuthMiddleware(
		{
			currentUser: () =>
				Effect.succeed({
					image: null,
					name: "User",
					email: "user@example.com",
					id: UserId.make("user-1"),
					preferences: { allowNsfw: false, language: null, disableIntegrations: false },
				}),
		},
		{ isActive: () => Effect.succeed(true) },
	);
	const routes = HttpRouter.add(
		"POST",
		"/",
		middleware(
			Effect.sync(() => {
				handlerCalled = true;
				return HttpServerResponse.empty();
			}),
		),
	);

	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.promise(() => handler(new Request("http://localhost/", { method: "POST" }))).pipe(
				Effect.tap((response) =>
					Effect.sync(() => {
						expect(response.status).not.toBe(204);
						expect(handlerCalled).toBe(false);
					}),
				),
			),
		({ dispose }) => Effect.promise(dispose),
	);
});
