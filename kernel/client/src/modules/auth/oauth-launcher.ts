import { Browser } from "@capacitor/browser";
import { buildOAuthAuthorizationUrl, type PendingAuthorization } from "@ryot-app/contract/oauth";
import { Clock, Context, Data, Effect, Layer } from "effect";

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
	readonly codeChallenge: string;
	readonly pending: PendingAuthorization;
	readonly client: RuntimeOAuthClientDescriptor;
};

export type ExplicitOAuthClientDescriptor = {
	readonly serverOrigin: ServerOrigin;
	readonly client: RuntimeOAuthClientDescriptor;
};

const launch = (plan: OAuthLaunchPlan, authorizationUrl = plan.authorizationUrl) =>
	plan.client.nativeApplicationId !== null
		? Effect.tryPromise({
				try: () => Browser.open({ url: authorizationUrl }),
				catch: () => new OAuthLauncherError({ reason: "launch-failed" }),
			}).pipe(Effect.asVoid)
		: Effect.sync(() => window.location.assign(authorizationUrl));

export class OAuthLauncher extends Context.Service<OAuthLauncher>()("OAuthLauncher", {
	make: Effect.gen(function* () {
		const api = yield* PublicApi;
		const auth = yield* AuthService;
		const storage = yield* OAuthStorage;
		const serverService = yield* ServerService;
		const runtimeClient = yield* RuntimeOAuthClientService;
		const buildPlan = Effect.fn("OAuthLauncher.buildPlan")(function* (
			serverOrigin: ServerOrigin,
			client: RuntimeOAuthClientDescriptor,
			destination: unknown,
		) {
			const codeVerifier = generateOAuthRandomValue();
			const pending: PendingAuthorization = {
				codeVerifier,
				serverOrigin,
				clientId: client.clientId,
				redirectUri: client.callbackUri,
				nonce: generateOAuthRandomValue(),
				state: generateOAuthRandomValue(),
				createdAt: yield* Clock.currentTimeMillis,
				destination: authDestination(destination),
			};
			const codeChallenge = yield* deriveCodeChallenge(codeVerifier);
			yield* storage
				.setPending(pending)
				.pipe(
					Effect.catchTag("OAuthStorageError", (cause) =>
						Effect.fail(new OAuthLauncherError({ cause, reason: "storage-failed" })),
					),
				);
			return {
				client,
				pending,
				codeChallenge,
				authorizationUrl: buildOAuthAuthorizationUrl(serverOrigin, {
					codeChallenge,
					state: pending.state,
					nonce: pending.nonce,
					clientId: pending.clientId,
					redirectUri: pending.redirectUri,
				}),
			};
		});

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
			const plan = yield* buildPlan(serverOrigin, client, redirectIntent);
			return { plan, _tag: "Ready" } as const;
		});
		const prepareImpersonation = Effect.fn("OAuthLauncher.prepareImpersonation")(function* (
			serverOrigin: ServerOrigin,
		) {
			const client = yield* runtimeClient
				.forImpersonation(serverOrigin)
				.pipe(
					Effect.mapError(
						(cause) => new OAuthLauncherError({ cause, reason: "unknown-native-application" }),
					),
				);
			yield* api.getSystemConfig(serverOrigin);
			return yield* buildPlan(serverOrigin, client, "/");
		});

		return { launch, prepare, prepareImpersonation };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
