import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Context, Data, Effect, Layer, Schema } from "effect";

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

const DemoSignInResponse = strictStruct({ mode: Schema.Literals(["demo", "standard"]) });

export const requestDemoSignIn = (fetcher: typeof fetch, baseURL: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			catch: (cause) =>
				new HostedAuthError({
					message: cause instanceof Error ? cause.message : "Could not open the shared demo.",
				}),
			try: () =>
				fetcher(new URL("/api/auth/demo/sign-in", baseURL), {
					body: "{}",
					method: "POST",
					cache: "no-store",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
				}),
		});
		if (!response.ok) {
			return yield* new HostedAuthError({ message: "Could not open the shared demo." });
		}
		const payload = yield* Effect.tryPromise({
			try: () => response.json() as Promise<unknown>,
			catch: () => new HostedAuthError({ message: "Could not read the shared demo response." }),
		});
		return yield* Schema.decodeUnknownEffect(DemoSignInResponse)(payload).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "The shared demo returned an invalid response." }),
			),
		);
	});

const makeHostedClient = (baseURL = window.location.origin) =>
	createAuthClient({
		baseURL,
		fetchOptions: { credentials: "same-origin" },
		plugins: [twoFactorClient(), oauthProviderClient()],
	});

const request = <A>(operation: () => Promise<AuthResponse<A>>, fallback: string) =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) =>
			new HostedAuthError({ message: cause instanceof Error ? cause.message : fallback }),
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
		const signInDemo = () => requestDemoSignIn(globalThis.fetch, window.location.origin);
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

		return { signInDemo, resetPassword, signInWithOidc, verifyTwoFactor, submitCredentials };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
