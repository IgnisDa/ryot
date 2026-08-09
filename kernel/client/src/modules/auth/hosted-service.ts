import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Context, Data, Effect, Layer } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { TwoFactorMethod } from "#/modules/auth/flow";
import { availableTwoFactorMethods, isTwoFactorRedirect } from "#/modules/auth/flow";
import { registrationName, type CredentialsValues } from "#/modules/auth/form-values";

export class HostedAuthError extends Data.TaggedError("HostedAuthError")<{
	readonly code?: string;
	readonly message: string;
}> {}

type AuthResponse<A> = {
	readonly data: A;
	readonly error: null | { readonly code?: string; readonly message?: string };
};

const makeHostedClient = (baseURL = window.location.origin) =>
	createAuthClient({
		baseURL,
		fetchOptions: { credentials: "same-origin" },
		plugins: [twoFactorClient(), oauthProviderClient()],
	});

const request = <A>(operation: () => Promise<AuthResponse<A>>, fallback: string) =>
	Effect.tryPromise({
		catch: (cause) =>
			new HostedAuthError({ message: cause instanceof Error ? cause.message : fallback }),
		try: operation,
	}).pipe(
		Effect.flatMap((response) =>
			response.error
				? Effect.fail(
						new HostedAuthError({
							message: response.error.message ?? fallback,
							...(response.error.code ? { code: response.error.code } : {}),
						}),
					)
				: Effect.succeed(response.data),
		),
	);

export class HostedAuthService extends Context.Service<HostedAuthService>()("HostedAuthService", {
	make: Effect.sync(() => {
		let hosted: ReturnType<typeof makeHostedClient> | undefined;
		const client = () => (hosted ??= makeHostedClient());
		const submitCredentials = Effect.fn("HostedAuthService.submitCredentials")(function* (input: {
			readonly mode: "login" | "signup";
			readonly values: CredentialsValues;
		}) {
			if (input.mode === "signup") {
				yield* request(
					() =>
						client().signUp.email({ ...input.values, name: registrationName(input.values.email) }),
					"Could not create your account.",
				);
				return { _tag: "Authenticated" } as const;
			}
			const result = yield* request(
				() => client().signIn.email(input.values),
				"Could not sign in.",
			);
			return isTwoFactorRedirect(result)
				? ({
						_tag: "TwoFactor",
						methods: availableTwoFactorMethods(result.twoFactorMethods),
					} as const)
				: ({ _tag: "Authenticated" } as const);
		});
		const verifyTwoFactor = (method: TwoFactorMethod, code: string) =>
			request(
				() =>
					method === "backupCode"
						? client().twoFactor.verifyBackupCode({ code })
						: client().twoFactor.verifyTotp({ code }),
				"Could not verify that code.",
			).pipe(Effect.asVoid);
		const signInWithOidc = () =>
			request(
				() =>
					client().signIn.social({
						provider: "oidc",
						callbackURL: `${window.location.origin}/oauth/login`,
					}),
				"Could not open the identity provider.",
			).pipe(Effect.asVoid);
		const resetPassword = (server: ServerOrigin, token: string, newPassword: string) =>
			request(
				() => makeHostedClient(server).resetPassword({ token, newPassword }),
				"Could not reset your password.",
			).pipe(Effect.asVoid);

		return { resetPassword, signInWithOidc, submitCredentials, verifyTwoFactor };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
