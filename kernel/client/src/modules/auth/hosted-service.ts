import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { Browser } from "@capacitor/browser";
import {
	OAUTH_CONSENT_DETAILS_PATH,
	OAuthConsentDetails,
	OAuthConsentDetailsRequest,
	REPORTING_TIME_ZONE_HEADER,
} from "@ryot-app/contract/oauth";
import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Context, Deferred, Effect, Layer, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { TwoFactorMethod } from "#/modules/auth/flow";
import { availableTwoFactorMethods, isTwoFactorRedirect } from "#/modules/auth/flow";
import { type CredentialsValues, registrationName } from "#/modules/auth/form-values";
import type { OAuthFetch } from "#/modules/auth/oauth-endpoint";

type AuthResponse<A> = {
	readonly data: A;
	readonly error: null | { readonly code?: string; readonly message?: string };
};

export class HostedAuthError extends Schema.TaggedError<
	HostedAuthError,
	{ readonly brand: unique symbol }
>()("HostedAuthError", { message: Schema.String, code: Schema.optionalKey(Schema.String) }) {}

const DemoSignInResponse = strictStruct({ mode: Schema.Literals(["demo", "standard"]) });
const InitializationStatusResponse = strictStruct({
	status: Schema.Literals(["initializing", "ready"]),
});
const ImpersonationRedeemRequest = strictStruct({ ticket: Schema.String });
const ImpersonationRedeemResponse = strictStruct({ authorizationUrl: Schema.String });

export const requestDemoSignIn = (fetcher: OAuthFetch, baseURL: string) =>
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
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new HostedAuthError({ message: "Could not read the shared demo response." }),
		});
		return yield* Schema.decodeUnknownEffect(DemoSignInResponse)(payload).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "The shared demo returned an invalid response." }),
			),
		);
	});

export const requestInitializationStatus = (fetcher: OAuthFetch, baseURL: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			catch: (cause) =>
				new HostedAuthError({
					message:
						cause instanceof Error ? cause.message : "Could not check account initialization.",
				}),
			try: () =>
				fetcher(new URL("/api/auth/initialization-status", baseURL), {
					method: "GET",
					cache: "no-store",
					credentials: "same-origin",
				}),
		});
		if (!response.ok) {
			return yield* new HostedAuthError({
				message:
					response.status === 401
						? "Your sign-in session has ended. Please sign in again."
						: "Could not check account initialization.",
			});
		}
		const payload = yield* Effect.tryPromise({
			try: () => response.json() as Promise<unknown>,
			catch: () =>
				new HostedAuthError({ message: "Could not read the account initialization response." }),
		});
		return yield* Schema.decodeUnknownEffect(InitializationStatusResponse)(payload).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "The server returned an invalid account status." }),
			),
		);
	});

export const requestImpersonationRedeem = (fetcher: OAuthFetch, baseURL: string, ticket: string) =>
	Effect.gen(function* () {
		const body = yield* Schema.encodeEffect(Schema.fromJsonString(ImpersonationRedeemRequest))({
			ticket,
		}).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "Could not prepare the impersonation request." }),
			),
		);
		const response = yield* Effect.tryPromise({
			catch: (cause) =>
				new HostedAuthError({
					message: cause instanceof Error ? cause.message : "Could not continue impersonation.",
				}),
			try: () =>
				fetcher(new URL("/api/auth/impersonation/redeem", baseURL), {
					body,
					method: "POST",
					cache: "no-store",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
				}),
		});
		if (!response.ok) {
			return yield* new HostedAuthError({ message: "Could not continue impersonation." });
		}
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new HostedAuthError({ message: "Could not read the impersonation response." }),
		});
		return yield* Schema.decodeUnknownEffect(ImpersonationRedeemResponse)(payload).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						message: "The server returned an invalid impersonation response.",
					}),
			),
		);
	});

export const requestConsentDetails = Effect.fn("HostedAuthService.requestConsentDetails")(
	function* (fetcher: OAuthFetch, baseURL: string, oauthQuery: string) {
		const body = yield* Schema.encodeEffect(Schema.fromJsonString(OAuthConsentDetailsRequest))({
			oauth_query: oauthQuery,
		}).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "Could not prepare this access request." }),
			),
		);
		const response = yield* Effect.tryPromise({
			catch: () => new HostedAuthError({ message: "Could not reach this server. Try again." }),
			try: () =>
				fetcher(new URL(OAUTH_CONSENT_DETAILS_PATH, baseURL), {
					body,
					method: "POST",
					cache: "no-store",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
				}),
		});
		if (!response.ok) {
			return yield* new HostedAuthError({
				...(response.status === 401 ? { code: "UNAUTHORIZED" } : {}),
				message:
					response.status === 400
						? "This access request is invalid or has expired. Start the connection again from your app."
						: "Could not load this access request. Try again or restart the connection from your app.",
			});
		}
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new HostedAuthError({ message: "Could not read this access request." }),
		});
		return yield* Schema.decodeUnknownEffect(OAuthConsentDetails)(payload).pipe(
			Effect.mapError(
				() => new HostedAuthError({ message: "The server returned an invalid access request." }),
			),
		);
	},
);

const consentDetails = (oauthQuery: string) =>
	requestConsentDetails(globalThis.fetch, window.location.origin, oauthQuery);

const redeemImpersonation = (ticket: string) =>
	requestImpersonationRedeem(globalThis.fetch, window.location.origin, ticket);

// The URI becomes a link target and QR payload, so only a TOTP provisioning URI with a secret passes.
export const parseTotpEnrollment = (totpURI: string) => {
	const url = URL.parse(totpURI);
	const secret = url?.searchParams.get("secret");
	return url?.protocol === "otpauth:" && url.host === "totp" && secret ? { secret, totpURI } : null;
};

const oauthQueryBody = (oauthQuery: string) =>
	new URLSearchParams(oauthQuery).has("sig") ? { oauth_query: oauthQuery } : {};

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

export class HostedAuthService extends Context.Service<HostedAuthService>()(
	"@ryot-app/kernel-client/modules/auth/hosted-service/HostedAuthService",
	{
		make: Effect.sync(() => {
			let hosted: undefined | ReturnType<typeof makeHostedClient>;
			const client = () => (hosted ??= makeHostedClient());
			const signInDemo = Effect.suspend(() =>
				requestDemoSignIn(globalThis.fetch, window.location.origin),
			);
			const submitCredentials = Effect.fn("HostedAuthService.submitCredentials")(function* (input: {
				readonly oauthQuery: string;
				readonly mode: "login" | "signup";
				readonly values: CredentialsValues;
			}) {
				if (input.mode === "signup") {
					yield* request(
						() =>
							client().signUp.email(
								{
									...input.values,
									...oauthQueryBody(input.oauthQuery),
									name: registrationName(input.values.email),
								},
								{ headers: { [REPORTING_TIME_ZONE_HEADER]: deviceTimeZone() } },
							),
						"Could not create your account.",
					);
					return { _tag: "Authenticated" } as const;
				}
				const result = yield* request(
					() => client().signIn.email({ ...input.values, ...oauthQueryBody(input.oauthQuery) }),
					"Could not sign in.",
				);
				return isTwoFactorRedirect(result)
					? ({
							_tag: "TwoFactor",
							methods: availableTwoFactorMethods(result.twoFactorMethods),
						} as const)
					: ({ _tag: "Authenticated" } as const);
			});
			const verifyTwoFactor = (method: TwoFactorMethod, code: string, oauthQuery: string) =>
				request(
					() =>
						method === "backupCode"
							? client().twoFactor.verifyBackupCode({ code, ...oauthQueryBody(oauthQuery) })
							: client().twoFactor.verifyTotp({ code, ...oauthQueryBody(oauthQuery) }),
					"Could not verify that code.",
				).pipe(Effect.asVoid);
			const signInWithOidc = (oauthQuery: string) =>
				request(
					() =>
						client().signIn.social({
							provider: "oidc",
							...oauthQueryBody(oauthQuery),
							callbackURL: `${window.location.origin}/oauth/login`,
							additionalData: { reportingTimeZone: deviceTimeZone() },
						}),
					"Could not open the identity provider.",
				).pipe(Effect.asVoid);
			const submitConsent = (oauthQuery: string, accept: boolean) =>
				request(
					() => client().oauth2.consent({ accept, oauth_query: oauthQuery }),
					"Could not submit your decision. Try again.",
				).pipe(Effect.asVoid);

			const initializationStatus = Effect.suspend(() =>
				requestInitializationStatus(globalThis.fetch, window.location.origin),
			);
			const continueAfterInitialization = (oauthQuery: string) =>
				request(
					() => client().oauth2.continue({ postLogin: true, ...oauthQueryBody(oauthQuery) }),
					"Could not continue sign-in.",
				).pipe(Effect.asVoid);
			const signOutHosted = request(() => client().signOut(), "Could not sign out.").pipe(
				Effect.asVoid,
			);
			const twoFactorSession = request(
				() => client().getSession(),
				"Could not read your sign-in session.",
			).pipe(
				Effect.flatMap((session) =>
					session
						? Effect.succeed({ twoFactorEnabled: session.user.twoFactorEnabled === true })
						: Effect.fail(
								new HostedAuthError({
									message: "Your sign-in session has ended. Please sign in again.",
								}),
							),
				),
			);
			const enableTwoFactor = (password: string) =>
				request(
					() => client().twoFactor.enable({ password, method: "totp" }),
					"Could not start two-factor setup.",
				).pipe(
					Effect.flatMap((result) => {
						const enrollment =
							result?.method === "totp" ? parseTotpEnrollment(result.totpURI) : null;
						return enrollment && result?.method === "totp"
							? Effect.succeed({ ...enrollment, backupCodes: result.backupCodes })
							: Effect.fail(
									new HostedAuthError({ message: "The server returned an invalid setup key." }),
								);
					}),
				);
			const confirmTwoFactor = (code: string) =>
				request(() => client().twoFactor.verifyTotp({ code }), "Could not verify that code.").pipe(
					Effect.asVoid,
				);
			const regenerateBackupCodes = (password: string) =>
				request(
					() => client().twoFactor.generateBackupCodes({ password }),
					"Could not generate new backup codes.",
				).pipe(
					Effect.flatMap((result) =>
						result
							? Effect.succeed(result.backupCodes)
							: Effect.fail(
									new HostedAuthError({ message: "The server returned no backup codes." }),
								),
					),
				);
			const disableTwoFactor = (password: string) =>
				request(
					() => client().twoFactor.disable({ password }),
					"Could not turn off two-factor authentication.",
				).pipe(Effect.asVoid);
			const openTwoFactorManagement = Effect.fn("HostedAuthService.openTwoFactorManagement")(
				function* (server: ServerOrigin) {
					const finished = yield* Deferred.make<void>();
					yield* Effect.acquireUseRelease(
						Effect.tryPromise({
							catch: () => new HostedAuthError({ message: "Could not open the browser." }),
							try: () =>
								Browser.addListener("browserFinished", () =>
									Deferred.doneUnsafe(finished, Effect.void),
								),
						}),
						() =>
							Effect.tryPromise({
								try: () => Browser.open({ url: `${server}/oauth/two-factor` }),
								catch: () => new HostedAuthError({ message: "Could not open the browser." }),
							}).pipe(Effect.andThen(Deferred.await(finished))),
						(listener) => Effect.promise(() => listener.remove()),
					);
				},
			);
			const resetPassword = (server: ServerOrigin, token: string, newPassword: string) =>
				request(
					() => makeHostedClient(server).resetPassword({ token, newPassword }),
					"Could not reset your password.",
				).pipe(Effect.asVoid);

			return {
				signInDemo,
				submitConsent,
				resetPassword,
				signOutHosted,
				consentDetails,
				signInWithOidc,
				enableTwoFactor,
				verifyTwoFactor,
				disableTwoFactor,
				twoFactorSession,
				confirmTwoFactor,
				submitCredentials,
				redeemImpersonation,
				initializationStatus,
				regenerateBackupCodes,
				openTwoFactorManagement,
				continueAfterInitialization,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
