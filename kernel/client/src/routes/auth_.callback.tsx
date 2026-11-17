import { Browser } from "@capacitor/browser";
import {
	OAUTH_IMPERSONATION_CLIENT_IDS,
	OAUTH_NATIVE_CLIENT_IDS,
	OAUTH_WEB_CLIENT_IDS,
	type OAuthCallbackQuery,
} from "@ryot-app/contract/oauth";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { browserServerOrigin } from "#/api/origin";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";
import { OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";

const searchValue = (value: unknown) =>
	typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/auth_/callback")({
	component: CompletingSignIn,
	pendingComponent: CompletingSignIn,
	errorComponent: CouldNotCompleteSignIn,
	validateSearch: (search): OAuthCallbackQuery => ({
		code: searchValue(search.code),
		error: searchValue(search.error),
		state: searchValue(search.state),
		error_description: searchValue(search.error_description),
	}),
	beforeLoad: ({ search, context }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const runtimeClient = yield* RuntimeOAuthClientService;
				const selected = runtimeClient.isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: yield* browserServerOrigin;
				if (selected === null) {
					return yield* new OAuthTokenError({ reason: "missing-authorization" });
				}
				const origin = selected;
				const client = yield* runtimeClient
					.forServer(origin)
					.pipe(
						Effect.catchTag("RuntimeOAuthClientError", () =>
							Effect.fail(new OAuthTokenError({ reason: "invalid-callback" })),
						),
					);
				if (!search.state) {
					return yield* new OAuthTokenError({ reason: "invalid-callback" });
				}
				if (client.nativeApplicationId !== null) {
					yield* Effect.promise(() => Browser.close()).pipe(Effect.ignoreCause);
				}
				const tokens = yield* OAuthTokenService;
				if (search.error) {
					return yield* tokens.rejectAuthorization(origin, search.state);
				}
				if (!search.code) {
					return yield* new OAuthTokenError({ reason: "invalid-callback" });
				}
				const pending = yield* tokens.completeAuthorization(
					origin,
					client.nativeApplicationId === null ? OAUTH_WEB_CLIENT_IDS : OAUTH_NATIVE_CLIENT_IDS,
					client.callbackUri,
					search.state,
					search.code,
				);
				yield* Effect.flatMap(AuthService, (auth) => auth.settledSession(origin, true));
				return OAUTH_IMPERSONATION_CLIENT_IDS.some((clientId) => clientId === pending.clientId)
					? ({ kind: "impersonation" } as const)
					: ({
							kind: "redirect",
							destination: sanitizeRedirect(pending.destination) ?? "/",
						} as const);
			}).pipe(
				Effect.map((result) => {
					if (result.kind === "impersonation") {
						window.location.replace("/");
						return;
					}
					throw redirect({ replace: true, to: result.destination });
				}),
			),
		),
});

function CouldNotCompleteSignIn() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.auth-callback.failed-title"))}
			message={t(kernelMessage("client.route.auth-callback.failed-detail"))}
		/>
	);
}

function CompletingSignIn() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.auth-callback.completing-title"))}
			message={t(kernelMessage("client.route.auth-callback.completing-detail"))}
		/>
	);
}
