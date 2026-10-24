import type { ContractPayload, ContractSuccess, RequestHeaders } from "@ryot-app/contract/client";
import {
	getOAuthEndpoint,
	getOAuthResource,
	getWebOAuthLogoutCallbackUri,
	type ImpersonationAuthorization,
	OAUTH_END_SESSION_PATH,
	OAUTH_IMPERSONATION_NATIVE_CLIENT_ID,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
	OAUTH_TOKEN_PATH,
	OAuthTokenResponse,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Schema } from "effect";

import { requirePresent } from "~/support/assertions";
import { getSharedHarnessTarget } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

import { adminHeaders } from "./admin";
import { type Client, type PendingOAuth, prepareOAuth, responseCookie } from "./auth";
import { getApiClient, makeSession } from "./contract-client";

type StartUserImpersonationBody = ContractPayload<"instanceAdmin", "startUserImpersonation">;
type StartUserImpersonationResult = ContractSuccess<"instanceAdmin", "startUserImpersonation">;

const ImpersonationRedeemRequest = Schema.Struct({ ticket: Schema.String });
const ImpersonationRedeemResponse = Schema.Struct({ authorizationUrl: Schema.String });

type ImpersonationSession = {
	readonly authorization: ImpersonationAuthorization;
	readonly callback: URL;
	readonly client: Client;
	readonly cookie: string;
	readonly handoffExpiresAt: number;
	readonly pending: PendingOAuth;
	readonly redeemedAt: number;
	readonly tokens: OAuthTokenResponse;
};

export const prepareImpersonationAuthorization = (
	clientId: ImpersonationAuthorization["clientId"],
	target = getSharedHarnessTarget(),
) =>
	Effect.gen(function* () {
		const pending = yield* prepareOAuth(target.apiUrl);
		const authorizationUrl = new URL(pending.authorizationUrl);
		const authorization = {
			clientId,
			state: pending.state,
			nonce: requirePresent(
				authorizationUrl.searchParams.get("nonce"),
				"OAuth setup did not provide a nonce",
			),
			codeChallenge: requirePresent(
				authorizationUrl.searchParams.get("code_challenge"),
				"OAuth setup did not provide a code challenge",
			),
			redirectUri:
				clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
					? requirePresent(OAUTH_NATIVE_CALLBACK_URIS[0], "Native OAuth callback is not configured")
					: pending.redirectUri,
		} satisfies StartUserImpersonationBody;
		return { pending, authorization };
	});

export const startUserImpersonation = (
	userId: string,
	authorization: StartUserImpersonationBody,
	target = getSharedHarnessTarget(),
	headers: RequestHeaders = adminHeaders(getApiClient(target)),
) =>
	getApiClient(target).call(
		(client) =>
			client.instanceAdmin.startUserImpersonation({
				payload: authorization,
				params: { userId: UserId.make(userId) },
			}),
		headers,
	);

export const redeemImpersonationHandoff = (ticket: string, target = getSharedHarnessTarget()) =>
	Effect.gen(function* () {
		const response = yield* webRequest(
			getOAuthEndpoint(new URL(target.apiUrl).origin, "/api/auth/impersonation/redeem"),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: yield* Schema.encodeEffect(Schema.fromJsonString(ImpersonationRedeemRequest))({
					ticket,
				}),
			},
		);
		const sessionCookie = responseCookie(response);
		if (!response.ok) {
			return { response, sessionCookie };
		}
		const result = yield* Schema.decodeUnknownEffect(ImpersonationRedeemResponse)(
			yield* Effect.promise(() => response.json()),
		);
		return { response, sessionCookie, authorizationUrl: result.authorizationUrl };
	});

export const createImpersonationSession = (
	userId: string,
	clientId: ImpersonationAuthorization["clientId"] = OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	target = getSharedHarnessTarget(),
) =>
	Effect.gen(function* () {
		const { pending, authorization } = yield* prepareImpersonationAuthorization(clientId, target);
		const handoff: StartUserImpersonationResult = yield* startUserImpersonation(
			userId,
			authorization,
			target,
		);
		const redeemedAt = yield* Clock.currentTimeMillis;
		const redeemed = yield* redeemImpersonationHandoff(handoff.ticket, target);
		if (!redeemed.response.ok) {
			throw new Error(`Impersonation handoff redemption failed: ${redeemed.response.status}`);
		}
		const sessionCookie = requirePresent(
			redeemed.sessionCookie,
			"Impersonation redemption did not set a session cookie",
		);
		const authorizationUrl = requirePresent(
			redeemed.authorizationUrl,
			"Impersonation redemption did not return an authorization URL",
		);
		const authorizationResponse = yield* webRequest(authorizationUrl, {
			redirect: "manual",
			headers: { Cookie: sessionCookie },
		});
		if (authorizationResponse.status !== 302) {
			throw new Error(`Impersonation authorization failed: ${authorizationResponse.status}`);
		}
		const location = requirePresent(
			authorizationResponse.headers.get("location"),
			"Impersonation authorization did not redirect to its callback",
		);
		const callback = new URL(location, pending.serverOrigin);
		if (callback.searchParams.get("state") !== pending.state) {
			throw new Error("Impersonation authorization returned the wrong state");
		}
		const code = requirePresent(
			callback.searchParams.get("code"),
			"Impersonation authorization did not return an authorization code",
		);
		const tokenResponse = yield* webRequest(
			getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH),
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: clientId,
					grant_type: "authorization_code",
					code_verifier: pending.codeVerifier,
					redirect_uri: authorization.redirectUri,
					resource: getOAuthResource(pending.frontendOrigin),
				}),
			},
		);
		if (!tokenResponse.ok) {
			throw new Error(`Impersonation token exchange failed: ${tokenResponse.status}`);
		}
		const tokens = yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
			yield* Effect.promise(() => tokenResponse.json()),
		);
		const client = makeSession(
			target,
			{ Authorization: `Bearer ${tokens.access_token}` },
			UserId.make(userId),
		);
		return {
			tokens,
			client,
			pending,
			callback,
			redeemedAt,
			authorization,
			cookie: sessionCookie,
			handoffExpiresAt: handoff.expiresAt,
		} satisfies ImpersonationSession;
	});

export const refreshImpersonationOAuthTokens = (
	serverOrigin: string,
	clientId: ImpersonationAuthorization["clientId"],
	refreshToken: string,
) =>
	Effect.gen(function* () {
		const response = yield* webRequest(getOAuthEndpoint(serverOrigin, OAUTH_TOKEN_PATH), {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
				resource: getOAuthResource(new URL(serverOrigin).origin),
			}),
		});
		return {
			response,
			...(response.ok
				? {
						tokens: yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
							yield* Effect.promise(() => response.json()),
						),
					}
				: {}),
		};
	});

export const endImpersonationSession = (
	session: Pick<ImpersonationSession, "authorization" | "cookie" | "pending" | "tokens">,
) =>
	Effect.gen(function* () {
		const idToken = requirePresent(
			session.tokens.id_token,
			"OAuth exchange did not return an ID token",
		);
		const redirectUri =
			session.authorization.clientId === OAUTH_IMPERSONATION_NATIVE_CLIENT_ID
				? requirePresent(
						OAUTH_NATIVE_LOGOUT_CALLBACK_URIS[0],
						"Native OAuth logout callback is not configured",
					)
				: getWebOAuthLogoutCallbackUri(session.pending.frontendOrigin);
		const endSessionUrl = new URL(
			getOAuthEndpoint(session.pending.serverOrigin, OAUTH_END_SESSION_PATH),
		);
		endSessionUrl.search = new URLSearchParams({
			state: "impersonation",
			id_token_hint: idToken,
			post_logout_redirect_uri: redirectUri,
			client_id: session.authorization.clientId,
		}).toString();
		return yield* webRequest(endSessionUrl, {
			redirect: "manual",
			headers: { Cookie: session.cookie },
		});
	});
