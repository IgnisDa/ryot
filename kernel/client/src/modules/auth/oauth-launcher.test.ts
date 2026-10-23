import { describe, expect, it, layer } from "@effect/vitest";
import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import {
	buildOAuthAuthorizationUrl,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_PKCE_METHOD,
	OAUTH_SCOPE,
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
} from "@ryot-app/contract/oauth";
import { Context, Effect, Layer, Ref } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { fakeOAuthStorageLayer } from "#/modules/auth/oauth-storage.test-support";
import { makeRuntimeOAuthClient, RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { ServerService } from "#/modules/server/service";

const origin = decodeServerOrigin("https://ryot.example");
const systemConfig = {
	analytics: {},
	version: "v1.0.0",
	frontendOrigin: origin,
	pro: { isServerKeyValidated: false },
	notifications: { smtpEnabled: false },
	auth: { oidcEnabled: false, signupAllowed: true, localAuthDisabled: false },
	fileStorage: { temporaryUploadProvider: "local", preferredPermanentUploadProvider: "local" },
} satisfies SystemConfigResponse;
const authenticatedSession: SettledAuthSession = {
	status: "authenticated",
	accessClass: "standard",
	user: { image: null, id: "user-1", name: "Test User", email: "user@example.com" },
};

class LauncherProbe extends Context.Service<
	LauncherProbe,
	{ readonly authChecks: Effect.Effect<number>; readonly configChecks: Effect.Effect<number> }
>()("test/LauncherProbe") {}

const launcherLayer = (session: SettledAuthSession) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const authChecks = yield* Ref.make(0);
			const configChecks = yield* Ref.make(0);
			const dependencies = Layer.mergeAll(
				fakeOAuthStorageLayer(),
				Layer.effect(
					RuntimeOAuthClientService,
					makeRuntimeOAuthClient({
						isNative: () => false,
						getApplicationId: Effect.die("not used"),
					}),
				),
				Layer.succeed(ServerService, {
					connect: () => Effect.void,
					selected: Effect.succeed(origin),
				}),
				Layer.succeed(PublicApi, {
					checkHealth: () => Effect.void,
					getSystemConfig: () =>
						Ref.updateAndGet(configChecks, (count) => count + 1).pipe(Effect.as(systemConfig)),
				}),
				Layer.succeed(AuthService, {
					changeServer: () => Effect.void,
					clearSession: () => Effect.void,
					signOut: () => Effect.succeed(false),
					session: () => ({ getSnapshot: () => session, subscribe: () => () => undefined }),
					settledSession: () =>
						Ref.updateAndGet(authChecks, (count) => count + 1).pipe(Effect.as(session)),
				}),
			);
			return Layer.mergeAll(
				dependencies,
				OAuthLauncher.layer.pipe(Layer.provide(dependencies)),
				Layer.succeed(LauncherProbe, {
					authChecks: Ref.get(authChecks),
					configChecks: Ref.get(configChecks),
				}),
			);
		}),
	);

describe("OAuth authorization launcher", () => {
	it("builds an S256 authorization request with the API resource", () => {
		const pending: PendingAuthorization = {
			createdAt: 1,
			state: "state",
			nonce: "nonce",
			destination: "/library",
			codeVerifier: "verifier",
			clientId: OAUTH_WEB_CLIENT_ID,
			serverOrigin: "https://ryot.example",
			redirectUri: "https://ryot.example/auth/callback",
		};
		const url = new URL(
			buildOAuthAuthorizationUrl(origin, {
				state: pending.state,
				nonce: pending.nonce,
				clientId: pending.clientId,
				codeChallenge: "challenge",
				redirectUri: pending.redirectUri,
			}),
		);

		expect(url.pathname).toBe(OAUTH_AUTHORIZE_PATH);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			nonce: "nonce",
			state: "state",
			scope: OAUTH_SCOPE,
			response_type: "code",
			code_challenge: "challenge",
			client_id: OAUTH_WEB_CLIENT_ID,
			resource: "https://ryot.example/api",
			code_challenge_method: OAUTH_PKCE_METHOD,
			redirect_uri: "https://ryot.example/auth/callback",
		});
	});

	layer(launcherLayer(authenticatedSession))((test) => {
		test.effect("builds and stores an impersonation plan without the signed-in guard", () =>
			Effect.gen(function* () {
				const launcher = yield* OAuthLauncher;
				const probe = yield* LauncherProbe;
				const plan = yield* launcher.prepareImpersonation(origin);
				const url = new URL(plan.authorizationUrl);

				expect(plan.client.clientId).toBe("ryot-impersonation-web");
				expect(plan.client.callbackUri).toBe(`${origin}/auth/callback`);
				expect(plan.pending.codeVerifier).not.toBe("");
				expect(url.searchParams.get("code_challenge")).toBe(plan.codeChallenge);
				expect(yield* (yield* OAuthStorage).getPending(origin, plan.pending.state)).toEqual(
					plan.pending,
				);
				expect(yield* probe.authChecks).toBe(0);
				expect(yield* probe.configChecks).toBe(1);
			}),
		);
	});

	layer(launcherLayer(authenticatedSession))((test) => {
		test.effect("keeps the normal OAuth prepare signed-in guard", () =>
			Effect.gen(function* () {
				const launcher = yield* OAuthLauncher;
				const probe = yield* LauncherProbe;
				const result = yield* launcher.prepare("/settings", {
					serverOrigin: origin,
					client: {
						nativeApplicationId: null,
						clientId: OAUTH_WEB_CLIENT_ID,
						callbackUri: `${origin}/auth/callback`,
						logoutUri: `${origin}/auth/logout/callback`,
					},
				});

				expect(result).toEqual({ _tag: "Authenticated", destination: "/settings" });
				expect(yield* probe.authChecks).toBe(1);
				expect(yield* probe.configChecks).toBe(0);
			}),
		);
	});
});
