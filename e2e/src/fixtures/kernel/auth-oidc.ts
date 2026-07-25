import { Data, Effect } from "effect";
import { Events, OAuth2Server } from "oauth2-mock-server";

import { requirePresent } from "~/support/assertions";

import {
	continueOAuthAuthorization,
	exchangeOAuthCallback,
	prepareOAuth,
	responseCookie,
	type PendingOAuth,
} from "./auth";

export type MockOidcServer = {
	issuerUrl: string;
	server: OAuth2Server;
	setNextClaims: (claims: Record<string, unknown>) => void;
};

class OidcFixtureError extends Data.TaggedError("OidcFixtureError")<{
	readonly cause: unknown;
}> {}

const attempt = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (cause) => new OidcFixtureError({ cause }),
	});

export const startMockOidcServer = Effect.gen(function* () {
	const server = new OAuth2Server();
	yield* attempt(() => server.issuer.keys.generate("RS256"));
	yield* attempt(() => server.start(0, "127.0.0.1"));

	const claimsByCode = new Map<string, Record<string, unknown>>();
	let nextClaims: Record<string, unknown> | undefined;

	server.service.on(Events.BeforeAuthorizeRedirect, (redirect) => {
		const code = redirect.url.searchParams.get("code");
		if (code && nextClaims) {
			claimsByCode.set(code, nextClaims);
			nextClaims = undefined;
		}
	});

	server.service.on(Events.BeforeTokenSigning, (token, req) => {
		const code = req.body.code;
		const claims = code ? claimsByCode.get(code) : undefined;
		if (claims) {
			Object.assign(token.payload, claims);
		}
	});

	return {
		server,
		issuerUrl: requirePresent(server.issuer.url, "Mock OIDC server failed to expose an issuer URL"),
		setNextClaims: (claims: Record<string, unknown>) => {
			nextClaims = claims;
		},
	};
});

export const stopMockOidcServer = (mockOidcServer?: MockOidcServer) =>
	mockOidcServer?.server.listening ? attempt(() => mockOidcServer.server.stop()) : Effect.void;

export const performOidcSignIn = (
	mockOidcServer: MockOidcServer,
	username: string,
	apiUrl: string,
	claims?: Record<string, unknown>,
): Effect.Effect<{ pending: PendingOAuth; response: Response }, OidcFixtureError> =>
	Effect.gen(function* () {
		const pending = yield* attempt(() => prepareOAuth(apiUrl));
		const step1Response = yield* attempt(() =>
			fetch(`${apiUrl}/auth/sign-in/social`, {
				method: "POST",
				redirect: "manual",
				headers: { "Content-Type": "application/json", Origin: pending.frontendOrigin },
				body: JSON.stringify({
					provider: "oidc",
					callbackURL: `${pending.frontendOrigin}/oauth/login`,
				}),
			}),
		);
		const step1Data: { url?: string; redirect?: boolean } = yield* attempt(() =>
			step1Response.json(),
		);
		const authorizeUrl = requirePresent(
			step1Data.url,
			`oidcSignIn step 1 failed: url=${step1Data.url}, cookie=${step1Response.headers.get("set-cookie")}`,
		);
		const stateCookieHeader = requirePresent(
			step1Response.headers.get("set-cookie"),
			`oidcSignIn step 1 failed: url=${authorizeUrl}, cookie=${step1Response.headers.get("set-cookie")}`,
		);
		const [stateCookie] = stateCookieHeader.split(";");

		mockOidcServer.setNextClaims({
			sub: username,
			name: username,
			email: `${username}@example.com`,
			...claims,
		});
		const step2Response = yield* attempt(() => fetch(authorizeUrl, { redirect: "manual" }));
		const callbackUrl = requirePresent(
			step2Response.headers.get("location"),
			"oidcSignIn step 2 failed: no location header",
		);

		const cookieValue = stateCookie ?? "";
		const response = yield* attempt(() =>
			fetch(callbackUrl, {
				redirect: "manual",
				headers: { accept: "text/html", Cookie: cookieValue },
			}),
		);
		return { pending, response };
	});

export const oidcSignIn = (
	mockOidcServer: MockOidcServer,
	username: string,
	apiUrl: string,
	claims?: Record<string, unknown>,
): Effect.Effect<string, OidcFixtureError> =>
	Effect.gen(function* () {
		const { pending, response } = yield* performOidcSignIn(
			mockOidcServer,
			username,
			apiUrl,
			claims,
		);
		const sessionCookie = requirePresent(
			responseCookie(response),
			"OIDC callback did not establish a hosted session",
		);
		const authorization = yield* attempt(() => continueOAuthAuthorization(pending, sessionCookie));
		return yield* attempt(() => exchangeOAuthCallback(authorization, pending));
	});
