import { expect, it } from "@effect/vitest";
import {
	AuthRateLimited,
	AuthUnauthorized,
	AuthorizationContext,
	CurrentUser,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import { PluginsGroup } from "@ryot-app/contract/modules/plugins/contract";
import {
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Redacted } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
	credentialFromHeaders,
	getOAuthVerificationOptions,
	isDemoProtectedAuthRequest,
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
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const resolvedOAuth = {
	authorization: {
		userId: userRecord.id,
		accessClass: "standard" as const,
		credential: { kind: "oauth", clientId: "ryot-web" } as const,
	},
	user: {
		name: userRecord.name,
		image: userRecord.image,
		email: userRecord.email,
		id: UserId.make(userRecord.id),
		preferences: userRecord.preferences,
	},
};
const disabledUserRecord = { ...userRecord, disabledAt: new Date("2026-08-31T00:00:00.000Z") };

it("gates Better Auth user-owned mutations without blocking unrelated auth routes", () => {
	expect(isLifecycleProtectedAuthPath("/api-key/create")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/update-user")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/delete-user")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/revoke-other-sessions")).toBe(true);
	expect(isLifecycleProtectedAuthPath("/sign-in/email")).toBe(false);
	expect(isLifecycleProtectedAuthPath("/get-session")).toBe(false);
	expect(isLifecycleProtectedAuthPath("/list-accounts")).toBe(false);
	expect(isLifecycleProtectedAuthPath("/api-key/list")).toBe(false);
});

it("protects demo hosted-session mutations and non-demo OAuth authorization", () => {
	for (const path of [
		"/account-info",
		"/api-key/create",
		"/api-key/get",
		"/api-key/list",
		"/api-key/update",
		"/api-key/delete",
		"/change-email",
		"/change-password",
		"/get-access-token",
		"/list-accounts",
		"/list-sessions",
		"/refresh-token",
		"/set-password",
		"/update-user",
		"/delete-user",
		"/update-session",
		"/link-social",
		"/unlink-account",
		"/two-factor/enable",
		"/two-factor/disable",
		"/two-factor/get-totp-uri",
		"/two-factor/generate-backup-codes",
		"/revoke-session",
		"/revoke-sessions",
		"/revoke-other-sessions",
	]) {
		expect(isDemoProtectedAuthRequest(path, "demo")).toBe(true);
		expect(isDemoProtectedAuthRequest(path, "standard")).toBe(false);
	}
	expect(isDemoProtectedAuthRequest("/oauth2/authorize", "demo", OAUTH_WEB_CLIENT_ID)).toBe(true);
	expect(isDemoProtectedAuthRequest("/oauth2/authorize", "demo", OAUTH_NATIVE_CLIENT_ID)).toBe(
		true,
	);
	expect(isDemoProtectedAuthRequest("/oauth2/authorize", "demo", "unexpected-client")).toBe(true);
	expect(isDemoProtectedAuthRequest("/oauth2/authorize", "demo", OAUTH_DEMO_WEB_CLIENT_ID)).toBe(
		false,
	);
	for (const path of ["/sign-out", "/sign-in/email", "/two-factor/verify-totp"]) {
		expect(isDemoProtectedAuthRequest(path, "demo")).toBe(false);
	}
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
			{ key: "key", kind: "api-key" },
			() => Effect.die("unused").pipe(Effect.runPromise),
			() =>
				Promise.resolve({ valid: true, error: null, key: { id: "key-1", referenceId: "user-1" } }),
			() => Effect.succeed(userRecord),
		);
		expect(resolved.authorization).toEqual({
			userId: "user-1",
			accessClass: "standard",
			credential: { keyId: "key-1", kind: "api-key" },
		});
	}),
);

const oauth = (clientId: string, userId = "user-1") =>
	resolveCredential(
		{ kind: "oauth", token: "token" },
		() => Promise.resolve({ sub: userId, client_id: clientId }),
		() => Effect.die("unused").pipe(Effect.runPromise),
		() => Effect.succeed({ ...userRecord, id: userId }),
		"user-1",
	);

const apiKey = (userId: string, demoAccountId: string | null) =>
	resolveCredential(
		{ key: "key", kind: "api-key" },
		() => Effect.die("unused").pipe(Effect.runPromise),
		() => Promise.resolve({ valid: true, error: null, key: { id: "key-1", referenceId: userId } }),
		() => Effect.succeed({ ...userRecord, id: userId }),
		demoAccountId,
	);

it.effect("classifies credential authority from provenance and demo configuration", () =>
	Effect.gen(function* () {
		expect((yield* oauth(OAUTH_DEMO_WEB_CLIENT_ID)).authorization.accessClass).toBe("demo");
		expect((yield* oauth(OAUTH_WEB_CLIENT_ID)).authorization.accessClass).toBe("standard");
		expect((yield* oauth(OAUTH_NATIVE_CLIENT_ID)).authorization.accessClass).toBe("standard");
		expect((yield* oauth("unexpected-client")).authorization.accessClass).toBe("demo");
		expect((yield* oauth("unexpected-client", "other-user")).authorization.accessClass).toBe(
			"standard",
		);

		expect((yield* apiKey("user-1", "user-1")).authorization.accessClass).toBe("demo");
		expect((yield* apiKey("other-user", "user-1")).authorization.accessClass).toBe("standard");
		expect((yield* apiKey("user-1", null)).authorization.accessClass).toBe("standard");
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
				{ key: "key", kind: "api-key" },
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
			new AuthRateLimited({ reason: { retryAfterMs: 1_250, code: "api-key-rate-limited" } }),
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
			{ credential: Redacted.make("token"), endpoint: PluginsGroup.endpoints.events },
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
			{ credential: Redacted.make("token"), endpoint: PluginsGroup.endpoints.events },
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

const request = (
	accessClass: "standard" | "demo",
	endpoint:
		| typeof PluginsGroup.endpoints.events
		| typeof PluginsGroup.endpoints.install
		| typeof PluginsGroup.endpoints.updatePluginState,
) => {
	let handlerCalled = false;
	const middleware = makeAuthMiddleware(
		{
			apiKeyUser: () => Effect.die("unused"),
			oauthUser: () =>
				Effect.succeed({
					...resolvedOAuth,
					authorization: { ...resolvedOAuth.authorization, accessClass },
				}),
		},
		{ isActive: () => Effect.succeed(false) },
	);
	const effect = middleware
		.oauth(
			Effect.sync(() => {
				handlerCalled = true;
				return HttpServerResponse.empty();
			}),
			{ endpoint, credential: Redacted.make("token") },
		)
		.pipe(
			Effect.provideService(
				HttpServerRequest.HttpServerRequest,
				HttpServerRequest.fromWeb(new Request("http://localhost/", { method: "POST" })),
			),
		);
	return { effect, handlerCalled: () => handlerCalled };
};

it.effect("enforces representative demo endpoint policies with a typed 403", () => {
	return Effect.gen(function* () {
		for (const accessClass of ["demo", "standard"] as const) {
			const allowed = request(accessClass, PluginsGroup.endpoints.events);
			expect((yield* allowed.effect).status).toBe(204);
			expect(allowed.handlerCalled()).toBe(true);
		}
		const standard = request("standard", PluginsGroup.endpoints.install);
		expect((yield* standard.effect).status).toBe(204);
		expect(standard.handlerCalled()).toBe(true);

		const demo = request("demo", PluginsGroup.endpoints.install);
		const error = yield* Effect.flip(demo.effect);
		expect(error).toEqual(
			new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
		);
		expect(error).not.toBeInstanceOf(AuthUnauthorized);
		expect(demo.handlerCalled()).toBe(false);

		const stateUpdate = request("demo", PluginsGroup.endpoints.updatePluginState);
		expect(yield* Effect.flip(stateUpdate.effect)).toEqual(
			new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
		);
		expect(stateUpdate.handlerCalled()).toBe(false);
	});
});
