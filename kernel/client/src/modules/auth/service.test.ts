import { describe, expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const origin = decodeServerOrigin("https://example.com");
const equivalentOrigin = decodeServerOrigin("https://example.com/");

const userInfoResponse = {
	sub: "user-1",
	name: "Test User",
	email: "user@example.com",
	accessClass: "standard" as const,
	picture: "https://example.com/avatar.png",
};

const authenticatedUser = {
	id: "user-1",
	name: "Test User",
	email: "user@example.com",
	image: "https://example.com/avatar.png",
};

type TokenBehavior = Partial<OAuthTokenService["Service"]>;
type AccessTokenBehavior = OAuthTokenService["Service"]["accessToken"];

class FakeAuthDependencies extends Context.Service<
	FakeAuthDependencies,
	{
		readonly userInfoCalls: Effect.Effect<number>;
		readonly accessTokenCalls: Effect.Effect<number>;
		readonly clears: Effect.Effect<ReadonlyArray<string>>;
		readonly logouts: Effect.Effect<
			ReadonlyArray<{ readonly origin: string; readonly redirectUri: string }>
		>;
		readonly respondToAccessToken: (behavior: AccessTokenBehavior) => Effect.Effect<void>;
	}
>()("test/FakeAuthDependencies") {}

const runtimeClient = (isNative = false) =>
	Layer.effect(
		RuntimeOAuthClientService,
		makeRuntimeOAuthClient({
			isNative: () => isNative,
			getApplicationId: Effect.succeed("io.ryot.app"),
		}),
	);

const authLayer = (
	tokens: TokenBehavior = {},
	client: Layer.Layer<RuntimeOAuthClientService> = runtimeClient(),
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const userInfoCalls = yield* Ref.make(0);
			const accessTokenCalls = yield* Ref.make(0);
			const clears = yield* Ref.make<ReadonlyArray<string>>([]);
			const logouts = yield* Ref.make<
				ReadonlyArray<{ readonly origin: string; readonly redirectUri: string }>
			>([]);
			const accessToken = yield* Ref.make<AccessTokenBehavior>(
				tokens.accessToken ?? (() => Effect.succeed(null)),
			);
			const recordClear = (name: string) => Ref.update(clears, (all) => [...all, name]);
			const tokenService: OAuthTokenService["Service"] = {
				rejectAuthorization: () => Effect.die("not used"),
				completeAuthorization: () => Effect.die("not used"),
				clear: (server) =>
					recordClear("clear-auth").pipe(Effect.andThen(tokens.clear?.(server) ?? Effect.void)),
				userInfo: (server) =>
					Ref.update(userInfoCalls, (count) => count + 1).pipe(
						Effect.andThen(tokens.userInfo?.(server) ?? Effect.succeed(null)),
					),
				logout: (server, redirectUri) =>
					Ref.update(logouts, (all) => [...all, { redirectUri, origin: server }]).pipe(
						Effect.andThen(tokens.logout?.(server, redirectUri) ?? Effect.succeed(null)),
					),
				accessToken: (server, forceRefresh) =>
					Ref.update(accessTokenCalls, (count) => count + 1).pipe(
						Effect.andThen(Ref.get(accessToken)),
						Effect.flatMap((behavior) => behavior(server, forceRefresh)),
					),
			};
			return Layer.merge(
				AuthService.layer.pipe(
					Layer.provide(Layer.succeed(OAuthTokenService, tokenService)),
					Layer.provide(makeClientStorage({ clearServerSelection: recordClear("clear-server") })),
					Layer.provide(client),
				),
				Layer.succeed(FakeAuthDependencies, {
					clears: Ref.get(clears),
					logouts: Ref.get(logouts),
					userInfoCalls: Ref.get(userInfoCalls),
					accessTokenCalls: Ref.get(accessTokenCalls),
					respondToAccessToken: (behavior) => Ref.set(accessToken, behavior),
				}),
			);
		}),
	);

describe("authentication service", () => {
	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed(userInfoResponse),
		}),
	)((test) => {
		test.effect("restores an OAuth UserInfo response into the existing session snapshot", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const session = auth.session(origin);
				expect(session.getSnapshot()).toEqual({ status: "pending" });

				expect(yield* auth.settledSession(equivalentOrigin)).toEqual({
					accessClass: "standard",
					user: authenticatedUser,
					status: "authenticated",
				});
				expect(session.getSnapshot().status).toBe("authenticated");
			}),
		);
	});

	layer(authLayer())((test) => {
		test.effect("reports a missing session when no OAuth token set exists", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed({ ...userInfoResponse, accessClass: "demo" }),
		}),
	)((test) => {
		test.effect("exposes demo access from the stored OAuth client", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				expect(yield* auth.settledSession(origin)).toMatchObject({
					accessClass: "demo",
					status: "authenticated",
				});
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed(userInfoResponse),
		}),
	)((test) => {
		test.effect(
			"resolves UserInfo once and serves later navigations from the settled snapshot",
			() =>
				Effect.gen(function* () {
					const auth = yield* AuthService;
					const dependencies = yield* FakeAuthDependencies;
					const session = auth.session(origin);
					let notifications = 0;
					session.subscribe(() => {
						notifications += 1;
					});
					const observed: string[] = [];
					for (let navigation = 0; navigation < 3; navigation += 1) {
						observed.push((yield* auth.settledSession(origin)).status);
						observed.push(session.getSnapshot().status);
					}

					expect(observed).toEqual(Array.from({ length: 6 }, () => "authenticated"));
					expect(yield* dependencies.userInfoCalls).toBe(1);
					expect(yield* dependencies.accessTokenCalls).toBe(3);
					expect(notifications).toBe(1);
				}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.promise(() => Promise.resolve(userInfoResponse)),
		}),
	)((test) => {
		test.effect("shares one UserInfo request across concurrent navigations", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const results = yield* Effect.all(
					Array.from({ length: 4 }, () => auth.settledSession(origin)),
					{ concurrency: "unbounded" },
				);

				expect(results.map((result) => result.status)).toEqual(
					Array.from({ length: 4 }, () => "authenticated"),
				);
				expect(yield* (yield* FakeAuthDependencies).userInfoCalls).toBe(1);
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed(userInfoResponse),
		}),
	)((test) => {
		test.effect("demotes a settled session once the stored authorization is gone", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const dependencies = yield* FakeAuthDependencies;
				const session = auth.session(origin);
				expect((yield* auth.settledSession(origin)).status).toBe("authenticated");

				yield* dependencies.respondToAccessToken(() => Effect.succeed(null));
				expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
				expect(session.getSnapshot()).toEqual({ status: "missing" });
				expect(yield* dependencies.userInfoCalls).toBe(1);
			}),
		);
	});

	layer(
		authLayer({ accessToken: () => Effect.fail(new OAuthTokenError({ reason: "invalid-grant" })) }),
	)((test) => {
		test.effect("demotes a settled session when the refresh token is rejected", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const session = auth.session(origin);
				expect(yield* auth.settledSession(origin)).toEqual({ status: "missing" });
				expect(session.getSnapshot()).toEqual({ status: "missing" });
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed(userInfoResponse),
		}),
	)((test) => {
		test.effect("keeps a settled session when the authorization probe fails transiently", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const dependencies = yield* FakeAuthDependencies;
				const session = auth.session(origin);
				let notifications = 0;
				session.subscribe(() => {
					notifications += 1;
				});
				expect((yield* auth.settledSession(origin)).status).toBe("authenticated");

				yield* dependencies.respondToAccessToken(() =>
					Effect.fail(new OAuthTokenError({ reason: "request-failed" })),
				);
				expect(yield* auth.settledSession(origin)).toEqual({
					accessClass: "standard",
					status: "authenticated",
					user: authenticatedUser,
				});
				expect(session.getSnapshot().status).toBe("authenticated");
				expect(notifications).toBe(1);
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.fail(new OAuthTokenError({ reason: "request-failed" })),
		}),
	)((test) => {
		test.effect("fails when the probe fails transiently before the session ever settles", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const error = yield* Effect.flip(auth.settledSession(origin));
				expect(error.reason).toBe("request-failed");
			}),
		);
	});

	layer(
		authLayer({
			accessToken: () => Effect.succeed("access-1"),
			userInfo: () => Effect.succeed(userInfoResponse),
		}),
	)((test) => {
		test.effect("re-resolves UserInfo when the caller forces a refresh", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				expect((yield* auth.settledSession(origin)).status).toBe("authenticated");
				expect((yield* auth.settledSession(origin, true)).status).toBe("authenticated");
				expect(yield* (yield* FakeAuthDependencies).userInfoCalls).toBe(2);
			}),
		);
	});

	layer(authLayer())((test) => {
		test.effect("logs out OAuth authentication and updates subscribers", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				const session = auth.session(origin);
				yield* auth.signOut(origin);
				expect(
					(yield* (yield* FakeAuthDependencies).logouts).map(({ origin: server }) => server),
				).toEqual([origin]);
				expect(session.getSnapshot()).toEqual({ status: "missing" });
			}),
		);
	});

	layer(authLayer({ accessToken: () => Effect.succeed(null) }, runtimeClient(true)))((test) => {
		test.effect("uses the native callback descriptor for logout", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				yield* auth.settledSession(origin);
				expect(yield* auth.signOut(origin)).toBe(false);
				expect(
					(yield* (yield* FakeAuthDependencies).logouts).map(({ redirectUri }) => redirectUri),
				).toEqual(["io.ryot.app:/auth/logout/callback"]);
			}),
		);
	});

	layer(
		authLayer(
			{ logout: () => Effect.die("not used") },
			Layer.effect(
				RuntimeOAuthClientService,
				makeRuntimeOAuthClient({
					isNative: () => true,
					getApplicationId: Effect.succeed("io.ryot.unknown"),
				}),
			),
		),
	)((test) => {
		test.effect("clears local authentication when native application validation fails", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				expect(yield* auth.signOut(origin)).toBe(false);
				expect(yield* (yield* FakeAuthDependencies).clears).toEqual(["clear-auth"]);
			}),
		);
	});

	layer(authLayer())((test) => {
		test.effect("clears native server selection after local authentication", () =>
			Effect.gen(function* () {
				const auth = yield* AuthService;
				yield* auth.changeServer(origin);
				expect(yield* (yield* FakeAuthDependencies).clears).toEqual(["clear-auth", "clear-server"]);
			}),
		);
	});
});
