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

export async function startMockOidcServer(): Promise<MockOidcServer> {
	const server = new OAuth2Server();
	await server.issuer.keys.generate("RS256");
	await server.start(0, "127.0.0.1");

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
		setNextClaims: (claims) => {
			nextClaims = claims;
		},
	};
}

export async function stopMockOidcServer(mockOidcServer?: MockOidcServer) {
	if (mockOidcServer?.server.listening) {
		await mockOidcServer.server.stop();
	}
}

export async function performOidcSignIn(
	mockOidcServer: MockOidcServer,
	username: string,
	apiUrl: string,
	claims?: Record<string, unknown>,
): Promise<{ pending: PendingOAuth; response: Response }> {
	const configResponse = await fetch(`${apiUrl}/system/config`);
	const config: unknown = await configResponse.json();
	const frontendOrigin = requirePresent(
		config !== null &&
			typeof config === "object" &&
			typeof Reflect.get(config, "frontendOrigin") === "string"
			? Reflect.get(config, "frontendOrigin")
			: null,
		"OIDC server config did not expose its frontend origin",
	);
	const pending = await prepareOAuth(apiUrl, frontendOrigin);
	const step1Response = await fetch(`${apiUrl}/auth/sign-in/social`, {
		method: "POST",
		redirect: "manual",
		headers: { "Content-Type": "application/json", Origin: new URL(apiUrl).origin },
		body: JSON.stringify({
			provider: "oidc",
			callbackURL: `${frontendOrigin}/oauth/login`,
		}),
	});
	const step1Data: { url?: string; redirect?: boolean } = await step1Response.json();
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
	const step2Response = await fetch(authorizeUrl, { redirect: "manual" });
	const callbackUrl = requirePresent(
		step2Response.headers.get("location"),
		"oidcSignIn step 2 failed: no location header",
	);

	const cookieValue = stateCookie ?? "";
	const response = await fetch(callbackUrl, {
		redirect: "manual",
		headers: { accept: "text/html", Cookie: cookieValue },
	});
	return { pending, response };
}

export async function oidcSignIn(
	mockOidcServer: MockOidcServer,
	username: string,
	apiUrl: string,
	claims?: Record<string, unknown>,
): Promise<string> {
	const { pending, response } = await performOidcSignIn(mockOidcServer, username, apiUrl, claims);
	const sessionCookie = requirePresent(
		responseCookie(response),
		"OIDC callback did not establish a hosted session",
	);
	return exchangeOAuthCallback(await continueOAuthAuthorization(pending, sessionCookie), pending);
}
