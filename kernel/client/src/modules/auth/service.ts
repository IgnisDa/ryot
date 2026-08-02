import { Context, Effect, Layer } from "effect";

import type { ServerOrigin } from "../../api/origin";
import { ClientStorage } from "../../persistence/storage";
import { AuthClient } from "./client";
import type { AuthMode, TwoFactorMethod } from "./flow";
import { availableTwoFactorMethods, isTwoFactorRedirect } from "./flow";
import { registrationName, type CredentialsValues } from "./form-values";

export type CredentialsResult =
	| { readonly _tag: "Authenticated" }
	| { readonly _tag: "TwoFactor"; readonly methods: readonly TwoFactorMethod[] };

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
			return isTwoFactorRedirect(result)
				? {
						_tag: "TwoFactor",
						methods: availableTwoFactorMethods(result.twoFactorMethods),
					}
				: ({ _tag: "Authenticated" } as const);
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
				Effect.ensuring(client.clear()),
			);
		});
		const changeServer = Effect.fn("AuthService.changeServer")(function* (
			origin: ServerOrigin | null,
		) {
			yield* clearSession(origin).pipe(Effect.ensuring(storage.clearServerSelection));
		});

		return {
			changeServer,
			submitCredentials,
			signOut: clearSession,
			session: client.session,
			signInWithOidc: client.signInWithOidc,
			verifyTwoFactor: client.verifyTwoFactor,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
