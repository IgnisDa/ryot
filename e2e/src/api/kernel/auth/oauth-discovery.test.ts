import {
	getOAuthEndpoint,
	getOAuthIssuer,
	isLoopbackOrigin,
	OAUTH_AUTHORIZE_PATH,
	OAUTH_PKCE_METHOD,
	OAUTH_TOKEN_PATH,
} from "@ryot/contract/oauth";
import { Effect } from "effect";

import { getApiUrl } from "~/support/api";
import { describe, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

// Better Auth coerces a non-loopback http issuer to https; issued tokens keep http.
const advertisedIssuer = (origin: string) =>
	isLoopbackOrigin(origin)
		? getOAuthIssuer(origin)
		: getOAuthIssuer(origin).replace(/^http:\/\//, "https://");

describe("GET /auth/.well-known/openid-configuration", () => {
	it.live("serves JSON discovery for the path-ful issuer", () =>
		Effect.gen(function* () {
			const apiUrl = getApiUrl();
			const frontendOrigin = getFrontendUrl();
			const response = yield* Effect.promise(() =>
				fetch(`${apiUrl}/auth/.well-known/openid-configuration`),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("application/json");
			expect(yield* Effect.promise(() => response.json())).toMatchObject({
				issuer: advertisedIssuer(frontendOrigin),
				code_challenge_methods_supported: [OAUTH_PKCE_METHOD],
				token_endpoint: getOAuthEndpoint(frontendOrigin, OAUTH_TOKEN_PATH),
				authorization_endpoint: getOAuthEndpoint(frontendOrigin, OAUTH_AUTHORIZE_PATH),
			});
			expect(response.headers.get("content-type")).not.toContain("text/html");
		}),
	);
});
