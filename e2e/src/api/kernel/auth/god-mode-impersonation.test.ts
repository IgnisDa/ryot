import {
	getOAuthEndpoint,
	getWebOAuthLogoutCallbackUri,
	OAuthUserInfoResponse,
	OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_USERINFO_PATH,
	OAUTH_WEB_CLIENT_ID,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Schema } from "effect";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	createAuthenticatedClient,
	createImpersonationSession,
	endImpersonationSession,
	getApiClient,
	getUserSettings,
	makeSession,
	prepareImpersonationAuthorization,
	redeemImpersonationHandoff,
	refreshImpersonationOAuthTokens,
	startUserImpersonation,
	updateUserSettingsPreferences,
} from "~/fixtures/kernel";
import {
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const WRONG_TOKEN = "wrong-token";

const authorizeWithClient = (
	authorizationUrl: string,
	sessionCookie: string,
	clientId: string,
	redirectUri: string,
) => {
	const url = new URL(authorizationUrl);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	return webRequest(url, { redirect: "manual", headers: { Cookie: sessionCookie } });
};

const runImpersonationClientFlow = (
	clientId: typeof OAUTH_IMPERSONATION_WEB_CLIENT_ID | typeof OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
) =>
	Effect.gen(function* () {
		const target = yield* createAuthenticatedClient();
		const impersonation = yield* createImpersonationSession(target.userId, clientId);
		if (clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID) {
			expect(`${impersonation.callback.protocol}${impersonation.callback.pathname}`).toBe(
				requirePresent(OAUTH_NATIVE_CALLBACK_URIS[0], "Native OAuth callback is not configured"),
			);
		} else {
			expect(`${impersonation.callback.origin}${impersonation.callback.pathname}`).toBe(
				impersonation.pending.redirectUri,
			);
		}

		const [tokenHeader, tokenPayload, tokenSignature] =
			impersonation.tokens.access_token.split(".");
		expect(tokenHeader).toBeTruthy();
		expect(tokenSignature).toBeTruthy();
		const encodedPayload = Buffer.from(
			requirePresent(tokenPayload, "Access token has no JWT payload"),
			"base64url",
		);
		const decodedClaims = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
			encodedPayload.toString("utf8"),
		);
		const claims = requireObjectRecord(decodedClaims, "Access token claims are not an object");
		expect(claims).toMatchObject({
			azp: clientId,
			sub: target.userId,
			impersonation: { expiresAt: expect.any(Number) },
		});
		const sessionId = requireString(claims["sid"], "Access token has no session ID");

		const sessionResponse = yield* webRequest(
			getOAuthEndpoint(impersonation.pending.serverOrigin, "/api/auth/get-session"),
			{ headers: { Cookie: impersonation.cookie } },
		);
		expect(sessionResponse.status).toBe(200);
		const sessionPayload: unknown = yield* Effect.promise(() => sessionResponse.json());
		const sessionBody = requireObjectRecord(
			sessionPayload,
			"Impersonation get-session response is invalid",
		);
		const sessionUser = requireObjectRecord(sessionBody["user"], "get-session has no user");
		const session = requireObjectRecord(sessionBody["session"], "get-session has no session");
		expect(sessionUser["id"]).toBe(target.userId);
		expect(session["userId"]).toBe(target.userId);
		expect(session["id"]).toBe(sessionId);
		const deadline = Date.parse(
			requireString(session["impersonationExpiresAt"], "Session has no impersonation deadline"),
		);
		expect(deadline).toBeGreaterThanOrEqual(impersonation.redeemedAt + 3_590_000);
		expect(deadline).toBeLessThanOrEqual(impersonation.redeemedAt + 3_610_000);

		const userInfoResponse = yield* webRequest(
			getOAuthEndpoint(impersonation.pending.serverOrigin, OAUTH_USERINFO_PATH),
			{ headers: { Authorization: `Bearer ${impersonation.tokens.access_token}` } },
		);
		expect(userInfoResponse.status).toBe(200);
		const userInfo = yield* Schema.decodeUnknownEffect(OAuthUserInfoResponse)(
			yield* Effect.promise(() => userInfoResponse.json()),
		);
		expect(userInfo.sub).toBe(target.userId);
		expect(userInfo.impersonation?.expiresAt).toBe(deadline);
		expect(claims["impersonation"]).toMatchObject({ expiresAt: deadline });

		const current = yield* getUserSettings(target.client);
		expect(current.preferences).toEqual({ language: null, disableIntegrations: false });
		const language = clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID ? "fr" : "es";
		yield* updateUserSettingsPreferences(impersonation.client, {
			language,
			disableIntegrations: true,
		});
		expect((yield* getUserSettings(impersonation.client)).preferences).toEqual({
			language,
			disableIntegrations: true,
		});
		expect((yield* getUserSettings(target.client)).preferences).toEqual({
			language,
			disableIntegrations: true,
		});

		const regularClientId =
			clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
				? OAUTH_NATIVE_CLIENT_ID
				: OAUTH_WEB_CLIENT_ID;
		const regularRedirectUri =
			clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
				? requirePresent(OAUTH_NATIVE_CALLBACK_URIS[0], "Native OAuth callback is not configured")
				: impersonation.pending.redirectUri;
		const regularAuthorization = yield* authorizeWithClient(
			impersonation.pending.authorizationUrl,
			impersonation.cookie,
			regularClientId,
			regularRedirectUri,
		);
		expect(regularAuthorization.status).toBe(403);

		const specialClientId =
			clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
				? OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
				: OAUTH_IMPERSONATION_WEB_CLIENT_ID;
		const specialAuthorization = yield* authorizeWithClient(
			impersonation.pending.authorizationUrl,
			target.sessionCookie,
			specialClientId,
			impersonation.authorization.redirectUri,
		);
		expect(specialAuthorization.status).toBe(403);

		const refreshToken = requirePresent(
			impersonation.tokens.refresh_token,
			"Impersonation exchange did not return a refresh token",
		);
		const refresh = yield* refreshImpersonationOAuthTokens(
			impersonation.pending.serverOrigin,
			clientId,
			refreshToken,
		);
		expect(refresh.response.status).toBe(200);
		const rotated = requirePresent(refresh.tokens, "Impersonation refresh returned no tokens");
		expect(rotated.access_token).not.toBe(impersonation.tokens.access_token);
		const refreshedClient = makeSession(
			getApiUrl(),
			{ Authorization: `Bearer ${rotated.access_token}` },
			UserId.make(target.userId),
		);
		expect((yield* getUserSettings(refreshedClient)).preferences).toEqual({
			language,
			disableIntegrations: true,
		});
	});

describe("God Mode impersonation", () => {
	it.live("requires the admin token and rejects unknown or disabled users", () =>
		Effect.gen(function* () {
			const target = yield* createAuthenticatedClient();
			const { authorization } = yield* prepareImpersonationAuthorization(
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
			);

			const wrongAdmin = yield* Effect.flip(
				startUserImpersonation(target.userId, authorization, adminAccessTokenHeaders(WRONG_TOKEN)),
			);
			assertTaggedError(wrongAdmin, "AuthUnauthorized");
			expect(wrongAdmin.reason.code).toBe("admin-access-required");

			const unknownUser = yield* Effect.flip(
				startUserImpersonation(`missing-${crypto.randomUUID()}`, authorization),
			);
			assertTaggedError(unknownUser, "GodModeNotFound");
			expect(unknownUser.reason.code).toBe("user-not-found");

			yield* getApiClient().call(
				(client) =>
					client.godMode.setUserDisabled({
						payload: { disabled: true },
						params: { userId: UserId.make(target.userId) },
					}),
				adminHeaders(),
			);
			const disabledUser = yield* Effect.flip(startUserImpersonation(target.userId, authorization));
			assertTaggedError(disabledUser, "GodModeRequestFailure");
			expect(disabledUser.reason.code).toBe("user-disabled");
		}),
	);

	it.live("redeems a handoff once and expires it within its one-minute window", () =>
		Effect.gen(function* () {
			const target = yield* createAuthenticatedClient();
			const { authorization } = yield* prepareImpersonationAuthorization(
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
			);
			const startedAt = yield* Clock.currentTimeMillis;
			const handoff = yield* startUserImpersonation(target.userId, authorization);
			const completedAt = yield* Clock.currentTimeMillis;
			expect(handoff.expiresAt).toBeGreaterThanOrEqual(startedAt + 60_000);
			expect(handoff.expiresAt).toBeLessThanOrEqual(completedAt + 60_000);

			const redeemed = yield* redeemImpersonationHandoff(handoff.ticket);
			expect(redeemed.response.status).toBe(200);
			expect(redeemed.sessionCookie).toBeTruthy();
			const replay = yield* redeemImpersonationHandoff(handoff.ticket);
			expect(replay.response.status).toBe(400);
			const expiring = yield* startUserImpersonation(target.userId, authorization);
			yield* Effect.sleep("61 seconds");
			const expired = yield* redeemImpersonationHandoff(expiring.ticket);
			expect(expired.response.status).toBe(400);
		}),
	);

	for (const clientId of [
		OAUTH_IMPERSONATION_WEB_CLIENT_ID,
		OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	] as const) {
		it.live(`completes the ${clientId} PKCE flow as the target user`, () =>
			runImpersonationClientFlow(clientId),
		);
	}

	it.live("ends a web impersonation session without invalidating the target's normal login", () =>
		Effect.gen(function* () {
			const target = yield* createAuthenticatedClient();
			const impersonation = yield* createImpersonationSession(
				target.userId,
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
			);
			const refreshToken = requirePresent(
				impersonation.tokens.refresh_token,
				"Impersonation exchange did not return a refresh token",
			);
			const refresh = yield* refreshImpersonationOAuthTokens(
				impersonation.pending.serverOrigin,
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
				refreshToken,
			);
			expect(refresh.response.status).toBe(200);
			const rotated = requirePresent(refresh.tokens, "Impersonation refresh returned no tokens");
			const latestRefreshToken = requirePresent(
				rotated.refresh_token,
				"Impersonation refresh did not return a rotated refresh token",
			);
			const endSession = yield* endImpersonationSession(impersonation);
			expect(endSession.status).toBe(302);
			const redirect = new URL(
				requirePresent(endSession.headers.get("location"), "End-session did not redirect"),
				impersonation.pending.serverOrigin,
			);
			expect(`${redirect.origin}${redirect.pathname}`).toBe(
				getWebOAuthLogoutCallbackUri(impersonation.pending.frontendOrigin),
			);
			expect(redirect.searchParams.get("state")).toBe("impersonation");
			expect(
				endSession.headers
					.getSetCookie()
					.some((cookie) => /(?:max-age=0|expires=thu, 01 jan 1970)/i.test(cookie)),
			).toBe(true);

			const clearedSession = yield* webRequest(
				getOAuthEndpoint(impersonation.pending.serverOrigin, "/api/auth/get-session"),
				{ headers: { Cookie: impersonation.cookie } },
			);
			expect(yield* Effect.promise(() => clearedSession.json())).toBeNull();

			const invalidAccessToken = yield* webRequest(`${getApiUrl()}/user-settings/two-factor`, {
				headers: { Authorization: `Bearer ${rotated.access_token}` },
			});
			expect(invalidAccessToken.status).toBe(401);
			const invalidRefreshToken = yield* refreshImpersonationOAuthTokens(
				impersonation.pending.serverOrigin,
				OAUTH_IMPERSONATION_WEB_CLIENT_ID,
				latestRefreshToken,
			);
			expect(invalidRefreshToken.response.status).toBe(400);
			expect((yield* getUserSettings(target.client)).id).toBe(target.userId);
		}),
	);
});
