import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { AuthClient, type SettledAuthSession } from "#/modules/auth/client";
import type { AuthMode, TwoFactorMethod } from "#/modules/auth/flow";
import { availableTwoFactorMethods, isTwoFactorRedirect } from "#/modules/auth/flow";
import { registrationName, type CredentialsValues } from "#/modules/auth/form-values";
import type { AuthSessionState } from "#/modules/auth/route-gates";
import { ClientStorage } from "#/persistence/storage";

export const toAuthSessionState = (session: SettledAuthSession): AuthSessionState =>
	session.status === "authenticated"
		? { status: "authenticated", userId: session.user.id }
		: { status: "missing" };

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const client = yield* AuthClient;
		const storage = yield* ClientStorage;
		const submitCredentials = Effect.fn("AuthService.submitCredentials")(function* (input: {
			readonly mode: AuthMode;
			readonly origin: ServerOrigin;
			readonly values: CredentialsValues;
		}) {
			if (input.mode === "signup") {
				yield* client.signUp(input.origin, {
					...input.values,
					name: registrationName(input.values.email),
				});
			}
			const result = yield* client.signIn(input.origin, input.values);
			if (isTwoFactorRedirect(result)) {
				return { _tag: "TwoFactor", methods: availableTwoFactorMethods(result.twoFactorMethods) };
			}
			yield* client.refreshSession(input.origin);
			return { _tag: "Authenticated" } as const;
		});
		const verifyTwoFactor = Effect.fn("AuthService.verifyTwoFactor")(function* (
			origin: ServerOrigin,
			method: TwoFactorMethod,
			code: string,
		) {
			yield* client.verifyTwoFactor(origin, method, code);
			yield* client.refreshSession(origin);
		});
		const verifyOneTimeToken = Effect.fn("AuthService.verifyOneTimeToken")(function* (
			origin: ServerOrigin,
			token: string,
		) {
			yield* client.verifyOneTimeToken(origin, token);
			yield* client.refreshSession(origin);
		});
		const clearSession = Effect.fn("AuthService.clearSession")(function* (
			origin: ServerOrigin | null,
		) {
			if (origin === null) {
				yield* client.clear();
				return;
			}
			yield* client.signOut(origin).pipe(
				Effect.catch(() => Effect.void),
				Effect.ensuring(client.clear().pipe(Effect.andThen(storage.clearSessionToken(origin)))),
			);
		});
		const changeServer = Effect.fn("AuthService.changeServer")(function* (
			origin: ServerOrigin | null,
		) {
			yield* clearSession(origin).pipe(Effect.ensuring(storage.clearServerSelection));
		});

		return {
			changeServer,
			verifyTwoFactor,
			submitCredentials,
			verifyOneTimeToken,
			signOut: clearSession,
			session: client.session,
			settledSession: client.settledSession,
			signInWithOidc: client.signInWithOidc,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
