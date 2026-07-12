import {
	OAUTH_AUTHORIZE_PATH,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_PKCE_METHOD,
	OAUTH_SCOPE,
	OAUTH_WEB_CLIENT_ID,
	type PendingAuthorization,
} from "@ryot/contract/oauth";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { buildAuthorizationUrl, selectOAuthClient } from "#/modules/auth/oauth-launcher";

const origin = decodeServerOrigin("https://ryot.example");

describe("OAuth authorization launcher", () => {
	it("selects the fixed client and callback for each platform", () => {
		expect(selectOAuthClient(false, origin)).toEqual({
			clientId: OAUTH_WEB_CLIENT_ID,
			redirectUri: "https://ryot.example/auth/callback",
		});
		expect(selectOAuthClient(true, origin, "io.ryot.app.dev")).toEqual({
			clientId: OAUTH_NATIVE_CLIENT_ID,
			redirectUri: "io.ryot.app.dev:/auth/callback",
		});
		expect(selectOAuthClient(true, origin, "unknown.app")).toBeNull();
	});

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
		const url = new URL(buildAuthorizationUrl(origin, pending, "challenge"));

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
});
