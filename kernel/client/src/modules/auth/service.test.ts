import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";
import { ClientStorage } from "#/persistence/storage";

const origin = decodeServerOrigin("https://example.com");
const equivalentOrigin = decodeServerOrigin("https://example.com/");

const userInfoResponse = {
	sub: "user-1",
	name: "Test User",
	email: "user@example.com",
	picture: "https://example.com/avatar.png",
};

const authenticatedUser = {
	id: "user-1",
	name: "Test User",
	email: "user@example.com",
	image: "https://example.com/avatar.png",
};

const makeTokens = (
	overrides: Partial<OAuthTokenService["Service"]> = {},
): OAuthTokenService["Service"] => ({
	clear: () => Effect.void,
	logout: () => Effect.succeed(null),
	userInfo: () => Effect.succeed(null),
	accessToken: () => Effect.succeed(null),
	rejectAuthorization: () => Effect.die("not used"),
	completeAuthorization: () => Effect.die("not used"),
	...overrides,
});

const makeStorage = (clearServerSelection: Effect.Effect<void> = Effect.void) =>
	Layer.succeed(ClientStorage, {
		clearServerSelection,
		remove: () => Effect.void,
		setLastWorkspace: () => Effect.void,
		setSavedViewLayout: () => Effect.void,
		setServerSelection: () => Effect.void,
		setThemePreference: () => Effect.void,
		setRememberedProvider: () => Effect.void,
		getServerSelection: Effect.succeed(null),
		getLastWorkspace: () => Effect.succeed(null),
		getRememberedProvider: () => Effect.succeed(null),
		getThemePreference: Effect.succeed("system" as const),
		getSavedViewLayout: () => Effect.succeed("grid" as const),
	});

const runtimeClient = (isNative = false) =>
	Layer.succeed(
		RuntimeOAuthClientService,
		makeRuntimeOAuthClient({
			isNative: () => isNative,
			getApplicationId: () => Promise.resolve("io.ryot.app"),
		}),
	);

const authLayer = (
	tokens: OAuthTokenService["Service"],
	storage: Layer.Layer<ClientStorage> = makeStorage(),
	client: Layer.Layer<RuntimeOAuthClientService> = runtimeClient(),
) =>
	AuthService.layer.pipe(
		Layer.provide(Layer.succeed(OAuthTokenService, tokens)),
		Layer.provide(storage),
		Layer.provide(client),
	);

describe("authentication service", () => {
	it.effect("restores an OAuth UserInfo response into the existing session snapshot", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			expect(session.getSnapshot()).toEqual({ status: "pending" });

			expect(yield* auth.settledSession(equivalentOrigin)).toEqual({
				user: authenticatedUser,
				status: "authenticated",
			});
			expect(session.getSnapshot().status).toBe("authenticated");
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.succeed("access-1"),
						userInfo: () => Effect.succeed(userInfoResponse),
					}),
				),
			),
		),
	);

	it.effect("reports a missing session when no OAuth token set exists", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
		}).pipe(Effect.provide(authLayer(makeTokens()))),
	);

	it.effect("resolves UserInfo once and serves later navigations from the settled snapshot", () => {
		let userInfoCalls = 0;
		let accessTokenCalls = 0;
		let notifications = 0;
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			session.subscribe(() => {
				notifications += 1;
			});
			const observed: string[] = [];
			for (let navigation = 0; navigation < 3; navigation += 1) {
				observed.push((yield* auth.settledSession(origin)).status);
				observed.push(session.getSnapshot().status);
			}

			expect(observed).toEqual(Array.from({ length: 6 }, () => "authenticated"));
			expect(userInfoCalls).toBe(1);
			expect(accessTokenCalls).toBe(3);
			expect(notifications).toBe(1);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () =>
							Effect.sync(() => {
								accessTokenCalls += 1;
								return "access-1";
							}),
						userInfo: () =>
							Effect.sync(() => {
								userInfoCalls += 1;
								return userInfoResponse;
							}),
					}),
				),
			),
		);
	});

	it.effect("shares one UserInfo request across concurrent navigations", () => {
		let userInfoCalls = 0;
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const results = yield* Effect.all(
				Array.from({ length: 4 }, () => auth.settledSession(origin)),
				{ concurrency: "unbounded" },
			);

			expect(results.map((result) => result.status)).toEqual(
				Array.from({ length: 4 }, () => "authenticated"),
			);
			expect(userInfoCalls).toBe(1);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.succeed("access-1"),
						userInfo: () =>
							Effect.promise(() => {
								userInfoCalls += 1;
								return Promise.resolve(userInfoResponse);
							}),
					}),
				),
			),
		);
	});

	it.effect("demotes a settled session once the stored authorization is gone", () => {
		let token: string | null = "access-1";
		let userInfoCalls = 0;
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			expect((yield* auth.settledSession(origin)).status).toBe("authenticated");

			token = null;
			expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
			expect(session.getSnapshot()).toEqual({ status: "missing" });
			expect(userInfoCalls).toBe(1);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.sync(() => token),
						userInfo: () =>
							Effect.sync(() => {
								userInfoCalls += 1;
								return userInfoResponse;
							}),
					}),
				),
			),
		);
	});

	it.effect("demotes a settled session when the refresh token is rejected", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
			expect(session.getSnapshot()).toEqual({ status: "missing" });
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.fail(new OAuthTokenError({ reason: "invalid-grant" })),
					}),
				),
			),
		),
	);

	it.effect("keeps a settled session when the authorization probe fails transiently", () => {
		let offline = false;
		let notifications = 0;
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			session.subscribe(() => {
				notifications += 1;
			});
			expect((yield* auth.settledSession(origin)).status).toBe("authenticated");

			offline = true;
			expect(yield* auth.settledSession(origin)).toEqual({
				status: "authenticated",
				user: authenticatedUser,
			});
			expect(session.getSnapshot().status).toBe("authenticated");
			expect(notifications).toBe(1);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						userInfo: () => Effect.succeed(userInfoResponse),
						accessToken: () =>
							offline
								? Effect.fail(new OAuthTokenError({ reason: "request-failed" }))
								: Effect.succeed("access-1"),
					}),
				),
			),
		);
	});

	it.effect("fails when the probe fails transiently before the session ever settles", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const error = yield* Effect.flip(auth.settledSession(origin));
			expect(error.reason).toBe("request-failed");
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.fail(new OAuthTokenError({ reason: "request-failed" })),
					}),
				),
			),
		),
	);

	it.effect("re-resolves UserInfo when the caller forces a refresh", () => {
		let userInfoCalls = 0;
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			expect((yield* auth.settledSession(origin)).status).toBe("authenticated");
			expect((yield* auth.settledSession(origin, true)).status).toBe("authenticated");
			expect(userInfoCalls).toBe(2);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: () => Effect.succeed("access-1"),
						userInfo: () =>
							Effect.sync(() => {
								userInfoCalls += 1;
								return userInfoResponse;
							}),
					}),
				),
			),
		);
	});

	it.effect("logs out OAuth authentication and updates subscribers", () => {
		const calls: string[] = [];
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session(origin);
			yield* auth.signOut(origin);
			expect(calls).toEqual([`clear:${origin}`]);
			expect(session.getSnapshot()).toEqual({ status: "missing" });
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						logout: (server) => Effect.sync(() => (calls.push(`clear:${server}`), null)),
					}),
				),
			),
		);
	});

	it.effect("uses the native client descriptor for session restoration and logout", () => {
		const calls: Array<{ readonly clientId: string; readonly logoutUri?: string }> = [];
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			yield* auth.settledSession(origin);
			expect(yield* auth.signOut(origin)).toBe(false);
			expect(calls).toEqual([
				{ clientId: "ryot-native" },
				{ clientId: "ryot-native", logoutUri: "io.ryot.app:/auth/logout/callback" },
			]);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						accessToken: (_server, clientId) => Effect.sync(() => (calls.push({ clientId }), null)),
						logout: (_server, clientId, logoutUri) =>
							Effect.sync(() => {
								calls.push({ clientId, logoutUri });
								return null;
							}),
					}),
					makeStorage(),
					runtimeClient(true),
				),
			),
		);
	});

	it.effect("clears local authentication when native application validation fails", () => {
		const calls: string[] = [];
		const invalidClient = Layer.succeed(
			RuntimeOAuthClientService,
			makeRuntimeOAuthClient({
				isNative: () => true,
				getApplicationId: () => Promise.resolve("io.ryot.unknown"),
			}),
		);
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			expect(yield* auth.signOut(origin)).toBe(false);
			expect(calls).toEqual(["clear"]);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						clear: () => Effect.sync(() => calls.push("clear")),
						logout: () => Effect.die("not used"),
					}),
					makeStorage(),
					invalidClient,
				),
			),
		);
	});

	it.effect("clears native server selection after local authentication", () => {
		const calls: string[] = [];
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			yield* auth.changeServer(origin);
			expect(calls).toEqual(["clear-auth", "clear-server"]);
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({ clear: () => Effect.sync(() => calls.push("clear-auth")) }),
					makeStorage(Effect.sync(() => calls.push("clear-server"))),
				),
			),
		);
	});
});
