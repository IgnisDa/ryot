import { Events, OAuth2Server } from "oauth2-mock-server";

import { requirePresent } from "~/support/assertions";

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
	backendUrl: string,
	claims?: Record<string, unknown>,
): Promise<Response> {
	const step1Response = await fetch(`${backendUrl}/auth/sign-in/oauth2`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ providerId: "oidc", callbackURL: `${new URL(backendUrl).origin}/` }),
		redirect: "manual",
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
		email: `${username}@example.com`,
		name: username,
		...claims,
	});
	const step2Response = await fetch(authorizeUrl, { redirect: "manual" });
	const callbackUrl = requirePresent(
		step2Response.headers.get("location"),
		"oidcSignIn step 2 failed: no location header",
	);

	const cookieValue = stateCookie ?? "";
	return fetch(callbackUrl, {
		redirect: "manual",
		headers: { Cookie: cookieValue },
	});
}

export async function oidcSignIn(
	mockOidcServer: MockOidcServer,
	username: string,
	backendUrl: string,
	claims?: Record<string, unknown>,
): Promise<string> {
	const step3Response = await performOidcSignIn(mockOidcServer, username, backendUrl, claims);
	const sessionCookieHeader = requirePresent(
		step3Response.headers.get("set-cookie"),
		`oidcSignIn step 3 failed: status=${step3Response.status}, location=${step3Response.headers.get("location")}, no set-cookie header`,
	);
	const sessionCookie = requirePresent(
		sessionCookieHeader.match(/better-auth\.session_token=[^;]+/),
		`oidcSignIn step 3 failed: session cookie missing from ${sessionCookieHeader}`,
	);

	return sessionCookie[0];
}
