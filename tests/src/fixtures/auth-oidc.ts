import { requirePresent } from "../test-support/assertions";

export async function oidcSignIn(
	username: string,
	backendUrl: string,
	claims?: Record<string, unknown>,
): Promise<string> {
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
	const callbackUrl = requirePresent(
		step2Response.headers.get("location"),
		"oidcSignIn step 2 failed: no location header",
	);

	const cookieValue = stateCookie ?? "";
	const step3Response = await fetch(callbackUrl, {
		redirect: "manual",
		headers: { Cookie: cookieValue },
	});
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
