import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import {
	getOAuthEndpoint,
	getOAuthResource,
	getWebOAuthCallbackUri,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_PKCE_METHOD,
	OAUTH_SCOPE,
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
} from "@ryot/contract/oauth";
import { Context, Data, Effect, Layer } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { authDestination } from "#/modules/auth/flow";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { deriveCodeChallenge, generateOAuthRandomValue } from "#/modules/auth/pkce";
import { AuthService } from "#/modules/auth/service";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { ServerService } from "#/modules/server/service";

const NATIVE_APPLICATION_IDS = ["io.ryot.app", "io.ryot.app.dev"] as const;

export class OAuthLauncherError extends Data.TaggedError("OAuthLauncherError")<{
	readonly reason: "unknown-native-application" | "launch-failed" | "storage-failed";
	readonly cause?: unknown;
}> {}

export type OAuthLaunchPlan = {
	readonly isNative: boolean;
	readonly authorizationUrl: string;
	readonly pending: PendingAuthorization;
};

export const selectOAuthClient = (
	isNative: boolean,
	serverOrigin: ServerOrigin,
	applicationId?: string,
) => {
	if (!isNative) {
		return {
			clientId: OAUTH_WEB_CLIENT_ID,
			redirectUri: getWebOAuthCallbackUri(serverOrigin),
		} as const;
	}
	if (!NATIVE_APPLICATION_IDS.some((id) => id === applicationId)) {
		return null;
	}
	return {
		clientId: OAUTH_NATIVE_CLIENT_ID,
		redirectUri: `${applicationId}:/auth/callback`,
	} as const;
};

export const buildAuthorizationUrl = (
	serverOrigin: ServerOrigin,
	pending: PendingAuthorization,
	codeChallenge: string,
) => {
	const url = new URL(getOAuthEndpoint(serverOrigin, OAUTH_AUTHORIZE_PATH));
	url.search = new URLSearchParams({
		scope: OAUTH_SCOPE,
		nonce: pending.nonce,
		state: pending.state,
		response_type: "code",
		client_id: pending.clientId,
		code_challenge: codeChallenge,
		redirect_uri: pending.redirectUri,
		code_challenge_method: OAUTH_PKCE_METHOD,
		resource: getOAuthResource(serverOrigin),
	}).toString();
	return url.toString();
};

export class OAuthLauncher extends Context.Service<OAuthLauncher>()("OAuthLauncher", {
	make: Effect.gen(function* () {
		const api = yield* PublicApi;
		const auth = yield* AuthService;
		const storage = yield* OAuthStorage;
		const serverService = yield* ServerService;
		const prepare = Effect.fn("OAuthLauncher.prepare")(function* (redirectIntent: unknown) {
			const isNative = isNativePlatform();
			const selected = isNative ? yield* serverService.selected : window.location.origin;
			if (selected === null) {
				return { _tag: "MissingServer" } as const;
			}
			const serverOrigin = normalizeServerOrigin(selected);
			const session = yield* auth.settledSession(serverOrigin);
			if (session.status === "authenticated") {
				return { _tag: "Authenticated", destination: authDestination(redirectIntent) } as const;
			}
			yield* api.getSystemConfig(serverOrigin);
			const applicationId = isNative
				? yield* Effect.tryPromise({
						try: () => App.getInfo().then((info) => info.id),
						catch: () => new OAuthLauncherError({ reason: "unknown-native-application" }),
					})
				: undefined;
			const client = selectOAuthClient(isNative, serverOrigin, applicationId);
			if (client === null) {
				return yield* new OAuthLauncherError({ reason: "unknown-native-application" });
			}
			const codeVerifier = generateOAuthRandomValue();
			const pending: PendingAuthorization = {
				...client,
				codeVerifier,
				serverOrigin,
				createdAt: Date.now(),
				nonce: generateOAuthRandomValue(),
				state: generateOAuthRandomValue(),
				destination: authDestination(redirectIntent),
			};
			const codeChallenge = yield* Effect.tryPromise(() => deriveCodeChallenge(codeVerifier));
			yield* storage
				.setPending(pending)
				.pipe(
					Effect.catchTag("OAuthStorageError", (cause) =>
						Effect.fail(new OAuthLauncherError({ reason: "storage-failed", cause })),
					),
				);
			return {
				_tag: "Ready",
				plan: {
					pending,
					isNative,
					authorizationUrl: buildAuthorizationUrl(serverOrigin, pending, codeChallenge),
				},
			} as const;
		});
		const launch = (plan: OAuthLaunchPlan) =>
			plan.isNative
				? Effect.tryPromise({
						catch: () => new OAuthLauncherError({ reason: "launch-failed" }),
						try: () => Browser.open({ url: plan.authorizationUrl }),
					}).pipe(Effect.asVoid)
				: Effect.sync(() => window.location.assign(plan.authorizationUrl));

		return { launch, prepare };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
