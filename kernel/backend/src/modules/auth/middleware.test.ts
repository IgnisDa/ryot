import { expect, it } from "@effect/vitest";
import {
	AuthRateLimited,
	AuthUnauthorized,
	AuthorizationContext,
	CurrentUser,
} from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Redacted } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import {
	credentialFromHeaders,
	getOAuthVerificationOptions,
	isLifecycleProtectedAuthPath,
	makeAuthMiddleware,
	resolveCredential,
} from "./service";

const userRecord = {
	image: null,
	name: "User",
	id: "user-1",
	disabledAt: null,
	email: "user@example.com",
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const resolvedOAuth = {
	authorization: {
		userId: userRecord.id,
		credential: { kind: "oauth", clientId: "ryot-web" } as const,
	},
	user: {
		name: userRecord.name,
		image: userRecord.image,
		email: userRecord.email,
		preferences: userRecord.preferences,
		id: UserId.make(userRecord.id),
	},
};
const disabledUserRecord = { ...userRecord, disabledAt: new Date("2026-08-31T00:00:00.000Z") };

it("gates Better Auth user-owned mutations without blocking unrelated auth routes", () => {
	expect(isLifecycleProtectedAuthPath("/api-key/create")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/update-user")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/sign-in/email")).toBe(false);
	expect(isLifecycleProtectedAuthPath("/get-session")).toBe(false);
});

it("extracts only explicit application credentials", () => {
	expect(
		credentialFromHeaders(new Headers({ cookie: "better-auth.session_token=stale" })),
	).toBeNull();
	expect(credentialFromHeaders(new Headers({ authorization: "Bearer oauth-token" }))).toEqual({
		kind: "oauth",
		token: "oauth-token",
	});
	expect(credentialFromHeaders(new Headers({ "x-api-key": "user-key" }))).toEqual({
		key: "user-key",
		kind: "api-key",
	});
});

it("configures OAuth verification for the Ryot issuer, resource, JWKS, and API scope", () => {
	expect(getOAuthVerificationOptions("https://ryot.example")).toEqual({
		requiredScopes: ["ryot:api"],
		jwksUrl: "https://ryot.example/api/auth/jwks",
		verifyOptions: {
			audience: "https://ryot.example/api",
			issuer: "https://ryot.example/api/auth",
		},
	});
});

it.effect("resolves an OAuth credential and its authorization context", () =>
	Effect.gen(function* () {
		const resolved = yield* resolveCredential(
			{ kind: "oauth", token: "token" },
			() => Promise.resolve({ sub: "user-1", client_id: "ryot-web" }),
			() => Effect.die("unused").pipe(Effect.runPromise),
			() => Effect.succeed(userRecord),
		);
		expect(resolved).toEqual(resolvedOAuth);
	}),
);

it.effect("resolves an API key and its authorization context", () =>
	Effect.gen(function* () {
		const resolved = yield* resolveCredential(
			{ kind: "api-key", key: "key" },
			() => Effect.die("unused").pipe(Effect.runPromise),
			() =>
				Promise.resolve({ valid: true, error: null, key: { id: "key-1", referenceId: "user-1" } }),
			() => Effect.succeed(userRecord),
		);
		expect(resolved.authorization).toEqual({
			userId: "user-1",
			credential: { kind: "api-key", keyId: "key-1" },
		});
	}),
);

it.effect("rejects invalid OAuth claims and disabled or deleted users", () =>
	Effect.gen(function* () {
		const invalidClaims = yield* Effect.flip(
			resolveCredential(
				{ kind: "oauth", token: "old-session-token" },
				() => Promise.resolve({ sub: "user-1" }),
				() => Effect.die("unused").pipe(Effect.runPromise),
				() => Effect.succeed(userRecord),
			),
		);
		expect(invalidClaims).toBeInstanceOf(AuthUnauthorized);

		for (const user of [null, disabledUserRecord]) {
			const error = yield* Effect.flip(
				resolveCredential(
					{ kind: "oauth", token: "token" },
					() => Promise.resolve({ sub: "user-1", client_id: "ryot-web" }),
					() => Effect.die("unused").pipe(Effect.runPromise),
					() => Effect.succeed(user),
				),
			);
			expect(error).toBeInstanceOf(AuthUnauthorized);
		}
	}),
);

it.effect("returns safe rate-limit metadata from API-key verification", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			resolveCredential(
				{ kind: "api-key", key: "key" },
				() => Effect.die("unused").pipe(Effect.runPromise),
				() =>
					Promise.resolve({
						key: null,
						valid: false,
						error: { code: "RATE_LIMITED", details: { tryAgainIn: 1_250 } },
					}),
				() => Effect.die("unused"),
			),
		);
		expect(error).toEqual(
			new AuthRateLimited({ reason: { code: "api-key-rate-limited", retryAfterMs: 1_250 } }),
		);
	}),
);

it.effect("provides both authentication services to handlers", () => {
	const middleware = makeAuthMiddleware(
		{ apiKeyUser: () => Effect.die("unused"), oauthUser: () => Effect.succeed(resolvedOAuth) },
		{ isActive: () => Effect.succeed(false) },
	);
	const routes = HttpRouter.add(
		"GET",
		"/",
		middleware.oauth(
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const authorization = yield* AuthorizationContext;
				expect(user.id).toBe("user-1");
				expect(authorization.credential).toEqual({ kind: "oauth", clientId: "ryot-web" });
				return HttpServerResponse.empty();
			}),
			{ credential: Redacted.make("token") },
		),
	);

	return Effect.acquireUseRelease(
		Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
		({ handler }) =>
			Effect.promise(() => handler(new Request("http://localhost/"))).pipe(
				Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(204))),
			),
		({ dispose }) => Effect.promise(dispose),
	);
});

it.effect("rejects authenticated writes while a lifecycle operation is active", () => {
	let handlerCalled = false;
	const middleware = makeAuthMiddleware(
		{ apiKeyUser: () => Effect.die("unused"), oauthUser: () => Effect.succeed(resolvedOAuth) },
		{ isActive: () => Effect.succeed(true) },
	);
	const routes = HttpRouter.add(
		"POST",
		"/",
		middleware.oauth(
			Effect.sync(() => {
				handlerCalled = true;
				return HttpServerResponse.empty();
			}),
			{ credential: Redacted.make("token") },
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
