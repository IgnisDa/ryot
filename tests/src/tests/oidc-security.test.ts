import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	LoginUserDocument,
	RegisterUserDocument,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parse } from "graphql";
import { getGraphqlClient, registerAdminUser } from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

const GetOidcRedirectUrlDocument = parse(`
	query GetOidcRedirectUrl {
		getOidcRedirectUrl {
			authorizationUrl
			browserToken
		}
	}
`);
const CompleteOidcLoginDocument = parse(`
	mutation CompleteOidcLogin($input: CompleteOidcLoginInput!) {
		completeOidcLogin(input: $input) {
			__typename
			... on ApiKeyResponse { apiKey }
			... on LoginError { error }
			... on StringIdObject { id }
		}
	}
`);
const UserByOidcIssuerIdDocument = parse(`
	query UserByOidcIssuerId($oidcIssuerId: String!) {
		userByOidcIssuerId(oidcIssuerId: $oidcIssuerId)
	}
`);

type OidcRedirect = {
	getOidcRedirectUrl: { authorizationUrl: string; browserToken: string };
};
type CompleteOidcLoginResponse = {
	completeOidcLogin:
		| { __typename: "ApiKeyResponse"; apiKey: string }
		| { __typename: "LoginError"; error: string }
		| { __typename: "StringIdObject"; id: string };
};
type OidcTransaction = {
	code: string;
	state: string;
	browserToken: string;
	subject: string;
	email: string;
};

const apiUrl = process.env.API_BASE_URL as string;
const issuerUrl = process.env.TEST_OIDC_ISSUER_URL as string;
const client = getGraphqlClient(apiUrl);

async function beginOidcTransaction(
	options: { subject?: string; email?: string; mode?: string } = {},
): Promise<OidcTransaction> {
	const { getOidcRedirectUrl } = await client.request<OidcRedirect>(
		GetOidcRedirectUrlDocument,
	);
	const subject = options.subject ?? `subject-${randomUUID()}`;
	const email = options.email ?? `user-${randomUUID()}@example.com`;
	const authorizationUrl = new URL(getOidcRedirectUrl.authorizationUrl);
	authorizationUrl.searchParams.set("test_subject", subject);
	authorizationUrl.searchParams.set("test_email", email);
	if (options.mode)
		authorizationUrl.searchParams.set("test_mode", options.mode);
	const authorizationResponse = await fetch(authorizationUrl, {
		redirect: "manual",
	});
	if (authorizationResponse.status !== 302) {
		throw new Error("Mock OIDC authorization did not redirect");
	}
	const callbackLocation = authorizationResponse.headers.get("location");
	if (!callbackLocation) throw new Error("Mock OIDC callback URL is missing");
	const callbackUrl = new URL(callbackLocation, issuerUrl);
	const code = callbackUrl.searchParams.get("code");
	const state = callbackUrl.searchParams.get("state");
	if (!code || !state)
		throw new Error("Mock OIDC callback parameters are missing");
	return {
		browserToken: getOidcRedirectUrl.browserToken,
		code,
		email,
		state,
		subject,
	};
}

const completeOidcLogin = (
	transaction: OidcTransaction,
	input: Partial<Pick<OidcTransaction, "state" | "browserToken">> = {},
) =>
	client.request<CompleteOidcLoginResponse>(CompleteOidcLoginDocument, {
		input: {
			code: transaction.code,
			state: input.state ?? transaction.state,
			browserToken: input.browserToken ?? transaction.browserToken,
		},
	});

async function userIdForOidcSubject(subject: string) {
	const response = await client.request<{ userByOidcIssuerId: string | null }>(
		UserByOidcIssuerIdDocument,
		{ oidcIssuerId: subject },
	);
	return response.userByOidcIssuerId;
}

async function authorizeProviderDirectly() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const redirectUri = `${issuerUrl}/test-callback`;
	const url = new URL("/authorize", issuerUrl);
	for (const [key, value] of Object.entries({
		client_id: "test-client",
		code_challenge: challenge,
		code_challenge_method: "S256",
		nonce: randomUUID(),
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "openid email",
		state: randomUUID(),
	})) {
		url.searchParams.set(key, value);
	}
	const response = await fetch(url, { redirect: "manual" });
	const location = response.headers.get("location");
	if (response.status !== 302 || !location) {
		throw new Error("Mock OIDC provider did not issue an authorization code");
	}
	return {
		code: new URL(location).searchParams.get("code") as string,
		redirectUri,
		verifier,
	};
}

function redeemProviderCode(
	transaction: Awaited<ReturnType<typeof authorizeProviderDirectly>>,
	verifier = transaction.verifier,
) {
	const body = new URLSearchParams({
		code: transaction.code,
		code_verifier: verifier,
		grant_type: "authorization_code",
		redirect_uri: transaction.redirectUri,
	});
	return fetch(`${issuerUrl}/token`, {
		method: "POST",
		headers: {
			authorization: `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`,
			"content-type": "application/x-www-form-urlencoded",
		},
		body,
	});
}

async function startFrontendFlow() {
	const pageResponse = await fetch(`${apiUrl}/auth?autoOidcLaunch=false`);
	expect(pageResponse.status).toBe(200);
	const startResponse = await fetch(
		`${apiUrl}/auth?intent=getOidcRedirectUrl`,
		{
			method: "POST",
			body: new FormData(),
			redirect: "manual",
		},
	);
	expect(startResponse.status).toBe(302);
	const browserCookie = startResponse.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith("OidcBrowser="));
	expect(browserCookie).toMatch(/HttpOnly/i);
	expect(browserCookie).toMatch(/SameSite=Lax/i);
	const cookieHeader = browserCookie?.split(";", 1)[0];
	const authorizationLocation = startResponse.headers.get("location");
	if (!cookieHeader || !authorizationLocation) {
		throw new Error("Frontend OIDC start response is incomplete");
	}
	const providerResponse = await fetch(authorizationLocation, {
		redirect: "manual",
	});
	const callbackLocation = providerResponse.headers.get("location");
	if (providerResponse.status !== 302 || !callbackLocation) {
		throw new Error("Mock OIDC provider did not return to the frontend");
	}
	expect(new URL(callbackLocation).pathname).toBe("/api/auth");
	return { callbackUrl: callbackLocation, cookieHeader };
}

describe("OIDC protocol security regressions", () => {
	beforeAll(async () => {
		await registerAdminUser(apiUrl);
	});

	it("registers a verified subject once and rejects subject-only public auth", async () => {
		const transaction = await beginOidcTransaction();
		const first = await completeOidcLogin(transaction);
		expect(first.completeOidcLogin.__typename).toBe("ApiKeyResponse");
		const userId = await userIdForOidcSubject(transaction.subject);
		expect(userId).toBeTruthy();

		const second = await completeOidcLogin(
			await beginOidcTransaction({
				subject: transaction.subject,
				email: transaction.email,
			}),
		);
		expect(second.completeOidcLogin.__typename).toBe("ApiKeyResponse");
		expect(await userIdForOidcSubject(transaction.subject)).toBe(userId);

		const forgedOidc = {
			oidc: { email: transaction.email, issuerId: transaction.subject },
		};
		await expect(
			client.request(LoginUserDocument, { input: forgedOidc }),
		).rejects.toThrow("verified authorization flow");
		await expect(
			client.request(RegisterUserDocument, {
				input: { data: forgedOidc },
			}),
		).rejects.toThrow("verified authorization flow");
	});

	it("logs concurrent verified callbacks for the same new subject into one account", async () => {
		const subject = `subject-${randomUUID()}`;
		const email = `user-${randomUUID()}@example.com`;
		const transactions = await Promise.all([
			beginOidcTransaction({ email, subject }),
			beginOidcTransaction({ email, subject }),
		]);
		const completions = await Promise.all(
			transactions.map((transaction) => completeOidcLogin(transaction)),
		);
		const userId = await userIdForOidcSubject(subject);
		expect(userId).toBeTruthy();
		for (const { completeOidcLogin } of completions) {
			expect(completeOidcLogin.__typename).toBe("ApiKeyResponse");
			if (completeOidcLogin.__typename !== "ApiKeyResponse")
				throw new Error("Expected both verified callbacks to log in");
			const { userDetails } = await client.request(
				UserDetailsDocument,
				{},
				{ Authorization: `Bearer ${completeOidcLogin.apiKey}` },
			);
			expect(userDetails).toMatchObject({
				id: userId,
				__typename: "UserDetails",
			});
		}
	});

	it("rejects missing or wrong browser tokens and random state without consuming a valid flow", async () => {
		const transaction = await beginOidcTransaction();
		await expect(
			completeOidcLogin(transaction, { browserToken: "" }),
		).rejects.toThrow();
		await expect(
			completeOidcLogin(transaction, { browserToken: "wrong-browser-token" }),
		).rejects.toThrow();
		await expect(
			completeOidcLogin(transaction, { state: randomUUID() }),
		).rejects.toThrow();
		const valid = await completeOidcLogin(transaction);
		expect(valid.completeOidcLogin.__typename).toBe("ApiKeyResponse");
	});

	it("rejects callback replay and permits only one competing completion", async () => {
		const replayed = await beginOidcTransaction();
		const first = await completeOidcLogin(replayed);
		expect(first.completeOidcLogin.__typename).toBe("ApiKeyResponse");
		await expect(completeOidcLogin(replayed)).rejects.toThrow();

		const competing = await beginOidcTransaction();
		const completions = await Promise.allSettled([
			completeOidcLogin(competing),
			completeOidcLogin(competing),
		]);
		const successful = completions.filter(
			(result): result is PromiseFulfilledResult<CompleteOidcLoginResponse> =>
				result.status === "fulfilled",
		);
		expect(successful).toHaveLength(1);
		expect(successful[0].value.completeOidcLogin.__typename).toBe(
			"ApiKeyResponse",
		);
	});

	it.each([
		"wrong_nonce",
		"wrong_issuer",
		"wrong_audience",
		"expired",
		"bad_signature",
		"missing_id_token",
	])("rejects an OIDC token with %s", async (mode) => {
		const transaction = await beginOidcTransaction({ mode });
		await expect(completeOidcLogin(transaction)).rejects.toThrow();
		expect(await userIdForOidcSubject(transaction.subject)).toBeNull();
	});

	it("enforces provider PKCE and one-use authorization codes", async () => {
		const invalidPkce = await authorizeProviderDirectly();
		const rejected = await redeemProviderCode(invalidPkce, "wrong-verifier");
		expect(rejected.status).toBe(400);

		const redirectMismatch = await authorizeProviderDirectly();
		const rejectedRedirect = await redeemProviderCode({
			...redirectMismatch,
			redirectUri: `${issuerUrl}/different-callback`,
		});
		expect(rejectedRedirect.status).toBe(400);

		const oneUse = await authorizeProviderDirectly();
		const exchanged = await redeemProviderCode(oneUse);
		expect(exchanged.status).toBe(200);
		await exchanged.body?.cancel();
		const replay = await redeemProviderCode(oneUse);
		expect(replay.status).toBe(400);
	});

	it("uses the HttpOnly browser cookie through the frontend OIDC callback", async () => {
		const flow = await startFrontendFlow();
		const callback = await fetch(flow.callbackUrl, {
			headers: { cookie: flow.cookieHeader },
			redirect: "manual",
		});
		expect(callback.status).toBe(302);
		expect(
			new URL(callback.headers.get("location") as string, apiUrl).pathname,
		).toBe("/");
		const callbackCookies = callback.headers.getSetCookie();
		expect(callbackCookies.some((cookie) => cookie.startsWith("Auth="))).toBe(
			true,
		);
		expect(
			callbackCookies.some(
				(cookie) =>
					cookie.startsWith("OidcBrowser=") && /Max-Age=0/i.test(cookie),
			),
		).toBe(true);

		const withoutCookie = await startFrontendFlow();
		const rejectedCallback = await fetch(withoutCookie.callbackUrl, {
			redirect: "manual",
		});
		expect(rejectedCallback.status).toBe(302);
		const redirectUrl = new URL(
			rejectedCallback.headers.get("location") as string,
			apiUrl,
		);
		expect(redirectUrl.pathname).toBe("/auth");
		expect(redirectUrl.searchParams.get("autoOidcLaunch")).toBe("false");
	});
});
