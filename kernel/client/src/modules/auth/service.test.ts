import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AuthClient, AuthClientError, type AuthSessionStore } from "#/modules/auth/client";
import { AuthService } from "#/modules/auth/service";
import { ClientStorage } from "#/persistence/storage";

const session: AuthSessionStore = {
	subscribe: () => () => undefined,
	getSnapshot: () => ({ status: "missing" }),
};

const makeAuthClient = (overrides: Partial<AuthClient["Service"]> = {}): AuthClient["Service"] => ({
	session: () => session,
	clear: () => Effect.void,
	signUp: () => Effect.void,
	signOut: () => Effect.void,
	signInWithOidc: () => Effect.void,
	verifyTwoFactor: () => Effect.void,
	signIn: () => Effect.succeed({}),
	settledSession: () => Effect.succeed({ status: "missing" }),
	...overrides,
});

const makeStorage = (clearServerSelection: Effect.Effect<void> = Effect.void) =>
	Layer.succeed(ClientStorage, {
		clearServerSelection,
		remove: () => Effect.void,
		setServerSelection: () => Effect.void,
		setThemePreference: () => Effect.void,
		getServerSelection: Effect.succeed(null),
		getThemePreference: Effect.succeed("system" as const),
	});

describe("authentication service", () => {
	it.effect("registers before signing in and returns the available two-factor methods", () => {
		const calls: string[] = [];
		const client = makeAuthClient({
			signUp: (_origin, values) => Effect.sync(() => calls.push(`signup:${values.name}`)),
			signIn: (_origin, values) =>
				Effect.sync(() => {
					calls.push(`signin:${values.email}`);
					return { twoFactorRedirect: true, twoFactorMethods: ["totp"] };
				}),
		});
		const dependencies = Layer.mergeAll(Layer.succeed(AuthClient, client), makeStorage());

		return Effect.gen(function* () {
			const service = yield* AuthService;
			const result = yield* service.submitCredentials({
				mode: "signup",
				origin: "https://example.com",
				values: { email: "user@example.com", password: "password" },
			});

			expect(result).toEqual({ _tag: "TwoFactor", methods: ["totp", "backupCode"] });
			expect(calls).toEqual(["signup:user", "signin:user@example.com"]);
		}).pipe(Effect.provide(AuthService.layer), Effect.provide(dependencies));
	});

	it.effect("clears local auth and server state when remote sign-out fails", () => {
		const calls: string[] = [];
		const client = makeAuthClient({
			clear: () => Effect.sync(() => calls.push("clear-auth")),
			signOut: () =>
				Effect.sync(() => calls.push("sign-out")).pipe(
					Effect.andThen(Effect.fail(new AuthClientError({ message: "offline" }))),
				),
		});
		const dependencies = Layer.mergeAll(
			Layer.succeed(AuthClient, client),
			makeStorage(Effect.sync(() => calls.push("clear-server"))),
		);

		return Effect.gen(function* () {
			const service = yield* AuthService;
			yield* service.changeServer("https://example.com");
			expect(calls).toEqual(["sign-out", "clear-auth", "clear-server"]);
		}).pipe(Effect.provide(AuthService.layer), Effect.provide(dependencies));
	});
});
