import { faker } from "@faker-js/faker";
import {
	GetPasswordChangeSessionDocument,
	SetPasswordViaSessionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { parse } from "graphql";
import {
	getGraphqlClient,
	registerAdminUser,
	registerTestUser,
	TEST_ADMIN_ACCESS_TOKEN,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";
import {
	agePasswordChangeSession,
	expireOidcAuthorizationSession,
	expirePasswordChangeSession,
} from "../setup/security-database";

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

type OidcRedirectResponse = {
	getOidcRedirectUrl: { authorizationUrl: string; browserToken: string };
};

const sessionIdFromUrl = (changeUrl: string, baseUrl: string) =>
	new URL(changeUrl, baseUrl).searchParams.get("sessionId");

describe("Authentication token expiry regressions", () => {
	const url = process.env.API_BASE_URL as string;
	const client = getGraphqlClient(url);
	const GetOidcRedirectUrlDocument = parse(`
		query GetOidcRedirectUrl {
			getOidcRedirectUrl {
				authorizationUrl
				browserToken
			}
		}
	`);

	beforeAll(async () => {
		await registerAdminUser(url);
	});

	it("rejects old and expired password change sessions", async () => {
		const [, normalUserId] = await registerTestUser(url);
		const [, adminUserId] = await registerAdminUser(url);
		const { getPasswordChangeSession: oldSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{
				input: {
					adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
					userId: normalUserId,
				},
			},
		);
		const { getPasswordChangeSession: expiredSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{
				input: {
					adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
					userId: adminUserId,
				},
			},
		);
		const oldSessionId = sessionIdFromUrl(oldSession.passwordChangeUrl, url);
		const expiredSessionId = sessionIdFromUrl(
			expiredSession.passwordChangeUrl,
			url,
		);
		expect(oldSessionId).toBeTruthy();
		expect(expiredSessionId).toBeTruthy();
		if (!oldSessionId || !expiredSessionId) {
			throw new Error("Expected password change session IDs");
		}

		agePasswordChangeSession(oldSessionId);
		expirePasswordChangeSession(expiredSessionId);
		for (const sessionId of [oldSessionId, expiredSessionId]) {
			await expect(
				client.request(SetPasswordViaSessionDocument, {
					input: { sessionId, password: faker.internet.password() },
				}),
			).rejects.toThrow("Password change session not found or expired");
		}
	});

	it("rejects an OIDC callback after its authorization session expires", async () => {
		const { getOidcRedirectUrl } = await client.request<OidcRedirectResponse>(
			GetOidcRedirectUrlDocument,
		);
		const state = new URL(getOidcRedirectUrl.authorizationUrl).searchParams.get(
			"state",
		);
		expect(state).toBeTruthy();
		if (!state) throw new Error("Expected OIDC authorization state");

		expireOidcAuthorizationSession(state);
		await expect(
			client.request(CompleteOidcLoginDocument, {
				input: {
					browserToken: getOidcRedirectUrl.browserToken,
					code: "expired-session-fake-code",
					state,
				},
			}),
		).rejects.toThrow("OIDC authorization session not found or expired");
	});
});
