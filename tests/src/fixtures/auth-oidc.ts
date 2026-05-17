export async function oidcSignIn(
	username: string,
	backendUrl: string,
	_oidcBaseUrl: string,
	claims?: Record<string, unknown>,
): Promise<string> {
	// Step 1: POST to /auth/sign-in/oauth2 to get the authorization URL.
	// Better Auth returns JSON { url, redirect } and sets a state cookie on this response.
	const step1Response = await fetch(`${backendUrl}/auth/sign-in/oauth2`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ providerId: "oidc", callbackURL: `${new URL(backendUrl).origin}/` }),
		redirect: "manual",
	});
	const stateCookieHeader = step1Response.headers.get("set-cookie");
	const step1Data: { url?: string; redirect?: boolean } = await step1Response.json();
	const authorizeUrl = step1Data.url;
	if (!authorizeUrl || !stateCookieHeader) {
		throw new Error(`oidcSignIn step 1 failed: url=${authorizeUrl}, cookie=${stateCookieHeader}`);
	}
	const [stateCookie] = stateCookieHeader.split(";");

	// Step 2: POST the authorization URL to the mock OIDC server with the username.
	// mock-oauth2-server auto-approves any username posted to the authorize endpoint.
	const resolvedClaims = {
		email: `${username}@example.com`,
		name: username,
		...claims,
	};
	const formBody = new URLSearchParams();
	formBody.set("username", username);
	formBody.set("claims", JSON.stringify(resolvedClaims));
	const step2Response = await fetch(authorizeUrl, {
		method: "POST",
		redirect: "manual",
		body: formBody.toString(),
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	});
	const callbackUrl = step2Response.headers.get("location");
	if (!callbackUrl) {
		throw new Error("oidcSignIn step 2 failed: no location header");
	}

	// Step 3: GET the backend callback URL with the state cookie.
	// Better Auth exchanges the code, creates/looks up the user, and sets a session cookie.
	const cookieValue = stateCookie ?? "";
	const step3Response = await fetch(callbackUrl, {
		redirect: "manual",
		headers: { Cookie: cookieValue },
	});
	const sessionCookieHeader = step3Response.headers.get("set-cookie");
	if (!sessionCookieHeader) {
		throw new Error(
			`oidcSignIn step 3 failed: status=${step3Response.status}, location=${step3Response.headers.get("location")}, no set-cookie header`,
		);
	}
	const sessionCookie = sessionCookieHeader.match(/better-auth\.session_token=[^;]+/);
	if (!sessionCookie) {
		throw new Error(`oidcSignIn step 3 failed: session cookie missing from ${sessionCookieHeader}`);
	}

	return sessionCookie[0];
}
