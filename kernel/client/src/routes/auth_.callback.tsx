import { Browser } from "@capacitor/browser";
import {
	OAuthCallbackQuery,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_WEB_CLIENT_IDS,
} from "@ryot-app/contract/oauth";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";
import { OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";

const searchValue = (value: unknown) =>
	typeof value === "string" && value !== "" ? value : undefined;

const completingSignIn = {
	title: "Completing sign-in",
	message: "Finishing the secure token exchange...",
};

export const Route = createFileRoute("/auth_/callback")({
	component: CompletingSignIn,
	errorComponent: CouldNotCompleteSignIn,
	pendingComponent: () => <AuthStatus {...completingSignIn} />,
	validateSearch: (search) =>
		Schema.decodeUnknownSync(OAuthCallbackQuery)({
			code: searchValue(search.code),
			error: searchValue(search.error),
			state: searchValue(search.state),
			error_description: searchValue(search.error_description),
		}),
	beforeLoad: async ({ search, context }) => {
		const destination = await context.runtime.runPromise(
			Effect.gen(function* () {
				const runtimeClient = yield* RuntimeOAuthClientService;
				const selected = runtimeClient.isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: decodeServerOrigin(window.location.origin);
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
					yield* Effect.tryPromise(() => Browser.close()).pipe(Effect.catch(() => Effect.void));
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
					client.nativeApplicationId === null ? OAUTH_WEB_CLIENT_IDS : [OAUTH_NATIVE_CLIENT_ID],
					client.callbackUri,
					search.state,
					search.code,
				);
				yield* Effect.flatMap(AuthService, (auth) => auth.settledSession(origin, true));
				return sanitizeRedirect(pending.destination) ?? "/";
			}),
		);
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: destination });
	},
});

function CompletingSignIn() {
	return <AuthStatus {...completingSignIn} />;
}

function CouldNotCompleteSignIn() {
	return (
		<AuthStatus
			title="Could not complete sign-in"
			message="This authorization response is invalid or has already been used. Start sign-in again."
		/>
	);
}
