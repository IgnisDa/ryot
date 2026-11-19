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
import { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { Context, Deferred, Effect, Layer, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { TwoFactorMethod } from "#/modules/auth/flow";
import { availableTwoFactorMethods, isTwoFactorRedirect } from "#/modules/auth/flow";
import { type CredentialsValues, registrationName } from "#/modules/auth/form-values";
import type { OAuthFetch } from "#/modules/auth/oauth-endpoint";

type AuthResponse<A> = { readonly data: A; readonly error: null | { readonly code?: string } };

export class HostedAuthError extends Schema.TaggedError<
	HostedAuthError,
	{ readonly brand: unique symbol }
>()("HostedAuthError", { reason: Message, code: Schema.optionalKey(Schema.String) }) {}

const DemoSignInResponse = strictStruct({ mode: Schema.Literals(["demo", "standard"]) });
const InitializationStatusResponse = strictStruct({
	status: Schema.Literals(["initializing", "ready"]),
});
const ImpersonationRedeemRequest = strictStruct({ ticket: Schema.String });
const ImpersonationRedeemResponse = strictStruct({ authorizationUrl: Schema.String });

export const requestDemoSignIn = (fetcher: OAuthFetch, baseURL: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			catch: () =>
				new HostedAuthError({ reason: kernelMessage("client.auth.hosted.demo-open-failed") }),
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
			return yield* new HostedAuthError({
				reason: kernelMessage("client.auth.hosted.demo-open-failed"),
			});
		}
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () =>
				new HostedAuthError({ reason: kernelMessage("client.auth.hosted.demo-read-failed") }),
		});
		return yield* Schema.decodeUnknownEffect(DemoSignInResponse)(payload).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.demo-response-invalid"),
					}),
			),
		);
	});

export const requestInitializationStatus = (fetcher: OAuthFetch, baseURL: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			catch: () =>
				new HostedAuthError({
					reason: kernelMessage("client.auth.hosted.initialization-check-failed"),
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
				reason:
					response.status === 401
						? kernelMessage("client.auth.hosted.session-ended")
						: kernelMessage("client.auth.hosted.initialization-check-failed"),
			});
		}
		const payload = yield* Effect.tryPromise({
			try: () => response.json() as Promise<unknown>,
			catch: () =>
				new HostedAuthError({
					reason: kernelMessage("client.auth.hosted.initialization-read-failed"),
				}),
		});
		return yield* Schema.decodeUnknownEffect(InitializationStatusResponse)(payload).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.initialization-status-invalid"),
					}),
			),
		);
	});

export const requestImpersonationRedeem = (fetcher: OAuthFetch, baseURL: string, ticket: string) =>
	Effect.gen(function* () {
		const body = yield* Schema.encodeEffect(Schema.fromJsonString(ImpersonationRedeemRequest))({
			ticket,
		}).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.impersonation-prepare-failed"),
					}),
			),
		);
		const response = yield* Effect.tryPromise({
			catch: () =>
				new HostedAuthError({
					reason: kernelMessage("client.auth.hosted.impersonation-continue-failed"),
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
			return yield* new HostedAuthError({
				reason: kernelMessage("client.auth.hosted.impersonation-continue-failed"),
			});
		}
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () =>
				new HostedAuthError({
					reason: kernelMessage("client.auth.hosted.impersonation-read-failed"),
				}),
		});
		return yield* Schema.decodeUnknownEffect(ImpersonationRedeemResponse)(payload).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.impersonation-response-invalid"),
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
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.consent-prepare-failed"),
					}),
			),
		);
		const response = yield* Effect.tryPromise({
			catch: () =>
				new HostedAuthError({ reason: kernelMessage("client.auth.hosted.server-unreachable") }),
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
				reason:
					response.status === 400
						? kernelMessage("client.auth.hosted.consent-invalid")
						: kernelMessage("client.auth.hosted.consent-load-failed"),
			});
		}
		const payload: unknown = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () =>
				new HostedAuthError({ reason: kernelMessage("client.auth.hosted.consent-read-failed") }),
		});
		return yield* Schema.decodeUnknownEffect(OAuthConsentDetails)(payload).pipe(
			Effect.mapError(
				() =>
					new HostedAuthError({
						reason: kernelMessage("client.auth.hosted.consent-response-invalid"),
					}),
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

const request = <A>(operation: () => Promise<AuthResponse<A>>, fallback: Message) =>
	Effect.tryPromise({
		try: operation,
		catch: () => new HostedAuthError({ reason: fallback }),
	}).pipe(
		Effect.flatMap((response) =>
			response.error
				? Effect.fail(
						new HostedAuthError({
							reason: fallback,
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
						kernelMessage("client.auth.hosted.sign-up-failed"),
					);
					return { _tag: "Authenticated" } as const;
				}
				const result = yield* request(
					() => client().signIn.email({ ...input.values, ...oauthQueryBody(input.oauthQuery) }),
					kernelMessage("client.auth.hosted.sign-in-failed"),
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
					kernelMessage("client.auth.hosted.code-verify-failed"),
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
					kernelMessage("client.auth.hosted.identity-provider-failed"),
				).pipe(Effect.asVoid);
			const submitConsent = (oauthQuery: string, accept: boolean, scopes: readonly string[]) =>
				request(
					() =>
						client().oauth2.consent({ accept, scope: scopes.join(" "), oauth_query: oauthQuery }),
					kernelMessage("client.auth.hosted.consent-submit-failed"),
				).pipe(Effect.asVoid);

			const initializationStatus = Effect.suspend(() =>
				requestInitializationStatus(globalThis.fetch, window.location.origin),
			);
			const continueAfterInitialization = (oauthQuery: string) =>
				request(
					() => client().oauth2.continue({ postLogin: true, ...oauthQueryBody(oauthQuery) }),
					kernelMessage("client.auth.hosted.continue-failed"),
				).pipe(Effect.asVoid);
			const signOutHosted = request(
				() => client().signOut(),
				kernelMessage("client.settings.account.session.failed"),
			).pipe(Effect.asVoid);
			const twoFactorSession = request(
				() => client().getSession(),
				kernelMessage("client.auth.hosted.session-read-failed"),
			).pipe(
				Effect.flatMap((session) =>
					session
						? Effect.succeed({ twoFactorEnabled: session.user.twoFactorEnabled === true })
						: Effect.fail(
								new HostedAuthError({ reason: kernelMessage("client.auth.hosted.session-ended") }),
							),
				),
			);
			const enableTwoFactor = (password: string) =>
				request(
					() => client().twoFactor.enable({ password, method: "totp" }),
					kernelMessage("client.auth.hosted.two-factor-setup-failed"),
				).pipe(
					Effect.flatMap((result) => {
						const enrollment =
							result?.method === "totp" ? parseTotpEnrollment(result.totpURI) : null;
						return enrollment && result?.method === "totp"
							? Effect.succeed({ ...enrollment, backupCodes: result.backupCodes })
							: Effect.fail(
									new HostedAuthError({
										reason: kernelMessage("client.auth.hosted.setup-key-invalid"),
									}),
								);
					}),
				);
			const confirmTwoFactor = (code: string) =>
				request(
					() => client().twoFactor.verifyTotp({ code }),
					kernelMessage("client.auth.hosted.code-verify-failed"),
				).pipe(Effect.asVoid);
			const regenerateBackupCodes = (password: string) =>
				request(
					() => client().twoFactor.generateBackupCodes({ password }),
					kernelMessage("client.auth.hosted.backup-codes-failed"),
				).pipe(
					Effect.flatMap((result) =>
						result
							? Effect.succeed(result.backupCodes)
							: Effect.fail(
									new HostedAuthError({
										reason: kernelMessage("client.auth.hosted.backup-codes-missing"),
									}),
								),
					),
				);
			const disableTwoFactor = (password: string) =>
				request(
					() => client().twoFactor.disable({ password }),
					kernelMessage("client.auth.hosted.two-factor-disable-failed"),
				).pipe(Effect.asVoid);
			const openTwoFactorManagement = Effect.fn("HostedAuthService.openTwoFactorManagement")(
				function* (server: ServerOrigin) {
					const finished = yield* Deferred.make<void>();
					yield* Effect.acquireUseRelease(
						Effect.tryPromise({
							try: () =>
								Browser.addListener("browserFinished", () =>
									Deferred.doneUnsafe(finished, Effect.void),
								),
							catch: () =>
								new HostedAuthError({
									reason: kernelMessage("client.auth.hosted.browser-open-failed"),
								}),
						}),
						() =>
							Effect.tryPromise({
								try: () => Browser.open({ url: `${server}/oauth/two-factor` }),
								catch: () =>
									new HostedAuthError({
										reason: kernelMessage("client.auth.hosted.browser-open-failed"),
									}),
							}).pipe(Effect.andThen(Deferred.await(finished))),
						(listener) => Effect.promise(() => listener.remove()),
					);
				},
			);
			const resetPassword = (server: ServerOrigin, token: string, newPassword: string) =>
				request(
					() => makeHostedClient(server).resetPassword({ token, newPassword }),
					kernelMessage("client.route.reset-password.reset-failed"),
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
