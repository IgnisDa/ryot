import { Browser } from "@capacitor/browser";
import {
	getOAuthEndpoint,
	getOAuthResource,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_PKCE_METHOD,
	OAUTH_SCOPE,
	type PendingAuthorization,
} from "@ryot-app/contract/oauth";
import { Context, Data, Effect, Layer } from "effect";

import { decodeServerOrigin, type ServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { authDestination } from "#/modules/auth/flow";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { deriveCodeChallenge, generateOAuthRandomValue } from "#/modules/auth/pkce";
import {
	RuntimeOAuthClientService,
	type RuntimeOAuthClientDescriptor,
} from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { ServerService } from "#/modules/server/service";

export class OAuthLauncherError extends Data.TaggedError("OAuthLauncherError")<{
	readonly cause?: unknown;
	readonly reason: "unknown-native-application" | "launch-failed" | "storage-failed";
}> {}

export type OAuthLaunchPlan = {
	readonly authorizationUrl: string;
	readonly pending: PendingAuthorization;
	readonly client: RuntimeOAuthClientDescriptor;
};

export type ExplicitOAuthClientDescriptor = {
	readonly serverOrigin: ServerOrigin;
	readonly client: RuntimeOAuthClientDescriptor;
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

const launch = (plan: OAuthLaunchPlan) =>
	plan.client.nativeApplicationId !== null
		? Effect.tryPromise({
				try: () => Browser.open({ url: plan.authorizationUrl }),
				catch: () => new OAuthLauncherError({ reason: "launch-failed" }),
			}).pipe(Effect.asVoid)
		: Effect.sync(() => window.location.assign(plan.authorizationUrl));

export class OAuthLauncher extends Context.Service<OAuthLauncher>()("OAuthLauncher", {
	make: Effect.gen(function* () {
		const api = yield* PublicApi;
		const auth = yield* AuthService;
		const storage = yield* OAuthStorage;
		const serverService = yield* ServerService;
		const runtimeClient = yield* RuntimeOAuthClientService;

		const prepare = Effect.fn("OAuthLauncher.prepare")(function* (
			redirectIntent: unknown,
			explicit?: ExplicitOAuthClientDescriptor,
		) {
			let selected: ServerOrigin | null;
			if (explicit) {
				selected = explicit.serverOrigin;
			} else if (runtimeClient.isNative) {
				selected = yield* serverService.selected;
			} else {
				selected = decodeServerOrigin(window.location.origin);
			}
			if (selected === null) {
				return { _tag: "MissingServer" } as const;
			}
			const serverOrigin = selected;
			const client = explicit
				? explicit.client
				: yield* runtimeClient
						.forServer(serverOrigin)
						.pipe(
							Effect.mapError(
								(cause) => new OAuthLauncherError({ cause, reason: "unknown-native-application" }),
							),
						);
			const session = yield* auth.settledSession(serverOrigin);
			if (session.status === "authenticated") {
				return { _tag: "Authenticated", destination: authDestination(redirectIntent) } as const;
			}
			yield* api.getSystemConfig(serverOrigin);
			const codeVerifier = generateOAuthRandomValue();
			const pending: PendingAuthorization = {
				codeVerifier,
				serverOrigin,
				createdAt: Date.now(),
				clientId: client.clientId,
				redirectUri: client.callbackUri,
				nonce: generateOAuthRandomValue(),
				state: generateOAuthRandomValue(),
				destination: authDestination(redirectIntent),
			};

			const codeChallenge = yield* Effect.tryPromise(() => deriveCodeChallenge(codeVerifier));
			yield* storage
				.setPending(pending)
				.pipe(
					Effect.catchTag("OAuthStorageError", (cause) =>
						Effect.fail(new OAuthLauncherError({ cause, reason: "storage-failed" })),
					),
				);
			return {
				_tag: "Ready",
				plan: {
					client,
					pending,
					authorizationUrl: buildAuthorizationUrl(serverOrigin, pending, codeChallenge),
				},
			} as const;
		});

		return { launch, prepare };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
