import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { OAuthCallbackQuery } from "@ryot/contract/oauth";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect, Schema } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { selectOAuthClient } from "#/modules/auth/oauth-launcher";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";
import { OAuthTokenError, OAuthTokenService } from "#/modules/auth/token-service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";

const searchValue = (value: unknown) =>
	typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/auth_/callback")({
	component: CompletingSignIn,
	pendingComponent: CompletingSignIn,
	errorComponent: CouldNotCompleteSignIn,
	validateSearch: (search) =>
		Schema.decodeUnknownSync(OAuthCallbackQuery)({
			code: searchValue(search.code),
			error: searchValue(search.error),
			state: searchValue(search.state),
			error_description: searchValue(search.error_description),
		}),
	beforeLoad: async ({ context, search }) => {
		const destination = await context.runtime.runPromise(
			Effect.gen(function* () {
				const isNative = isNativePlatform();
				const selected = isNative
					? yield* Effect.flatMap(ServerService, (service) => service.selected)
					: decodeServerOrigin(window.location.origin);
				if (selected === null) {
					return yield* new OAuthTokenError({ reason: "missing-authorization" });
				}
				const origin = selected;
				const applicationId = isNative
					? yield* Effect.tryPromise(() => App.getInfo().then((info) => info.id))
					: undefined;
				const client = selectOAuthClient(isNative, origin, applicationId);
				if (!client || !search.state) {
					return yield* new OAuthTokenError({ reason: "invalid-callback" });
				}
				if (isNative) {
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
					client.clientId,
					client.redirectUri,
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
	return <AuthStatus title="Completing sign-in" message="Finishing the secure token exchange..." />;
}

function CouldNotCompleteSignIn() {
	return (
		<AuthStatus
			title="Could not complete sign-in"
			message="This authorization response is invalid or has already been used. Start sign-in again."
		/>
	);
}
