import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ClientStorage } from "#/persistence/storage";

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
		setServerSelection: () => Effect.void,
		setThemePreference: () => Effect.void,
		getServerSelection: Effect.succeed(null),
		getLastWorkspace: () => Effect.succeed(null),
		getThemePreference: Effect.succeed("system" as const),
	});

const authLayer = (
	tokens: OAuthTokenService["Service"],
	storage: Layer.Layer<ClientStorage> = makeStorage(),
) =>
	AuthService.layer.pipe(
		Layer.provide(Layer.succeed(OAuthTokenService, tokens)),
		Layer.provide(storage),
	);

describe("authentication service", () => {
	it.effect("restores an OAuth UserInfo response into the existing session snapshot", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session("https://example.com");
			expect(session.getSnapshot()).toEqual({ status: "pending" });

			expect(yield* auth.settledSession("https://example.com/")).toEqual({
				status: "authenticated",
				user: {
					id: "user-1",
					name: "Test User",
					email: "user@example.com",
					image: "https://example.com/avatar.png",
				},
			});
			expect(session.getSnapshot().status).toBe("authenticated");
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						userInfo: () =>
							Effect.succeed({
								sub: "user-1",
								name: "Test User",
								email: "user@example.com",
								picture: "https://example.com/avatar.png",
							}),
					}),
				),
			),
		),
	);

	it.effect("reports a missing session when no OAuth token set exists", () =>
		Effect.gen(function* () {
			const auth = yield* AuthService;
			expect(yield* auth.settledSession("https://example.com")).toEqual({ status: "missing" });
		}).pipe(Effect.provide(authLayer(makeTokens()))),
	);

	it.effect("logs out OAuth authentication and updates subscribers", () => {
		const calls: string[] = [];
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			const session = auth.session("https://example.com");
			yield* auth.signOut("https://example.com");
			expect(calls).toEqual(["clear:https://example.com"]);
			expect(session.getSnapshot()).toEqual({ status: "missing" });
		}).pipe(
			Effect.provide(
				authLayer(
					makeTokens({
						logout: (origin) => Effect.sync(() => (calls.push(`clear:${origin}`), null)),
					}),
				),
			),
		);
	});

	it.effect("clears native server selection after local authentication", () => {
		const calls: string[] = [];
		return Effect.gen(function* () {
			const auth = yield* AuthService;
			yield* auth.changeServer("https://example.com");
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
