import { faker } from "@faker-js/faker";
import {
	GetPasswordChangeSessionDocument,
	LoginUserDocument,
	ProcessAccessLinkDocument,
	ResetUserDocument,
	SetPasswordViaSessionDocument,
	UserAccessLinksDocument,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	registerAdminUser,
	registerTestUser,
	TEST_ADMIN_ACCESS_TOKEN,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getSessionId,
	registerPasswordUser,
} from "../setup/authentication-fixtures";
import { createTestAccessLink } from "../setup/security-database";

describe("Password recovery security regressions", () => {
	const url = process.env.API_BASE_URL as string;
	let adminApiKey: string;

	beforeAll(async () => {
		[adminApiKey] = await registerAdminUser(url);
	});

	const adminHeaders = () => ({ Authorization: `Bearer ${adminApiKey}` });

	it("limits recovery session issuance to admins and valid admin tokens", async () => {
		const client = getGraphqlClient(url);
		const [, targetUserId] = await registerTestUser(url);
		const [normalUserApiKey] = await registerTestUser(url);
		const input = { userId: targetUserId };

		await expect(
			client.request(GetPasswordChangeSessionDocument, { input }),
		).rejects.toThrow("Administrator authorization required");
		await expect(
			client.request(
				GetPasswordChangeSessionDocument,
				{ input },
				{ Authorization: `Bearer ${normalUserApiKey}` },
			),
		).rejects.toThrow("Administrator authorization required");
		await expect(
			client.request(GetPasswordChangeSessionDocument, {
				input: { ...input, adminAccessToken: "wrong-admin-token" },
			}),
		).rejects.toThrow("Administrator authorization required");

		const { getPasswordChangeSession: tokenSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{
				input: { ...input, adminAccessToken: TEST_ADMIN_ACCESS_TOKEN },
			},
		);
		expect(tokenSession.userId).toBe(targetUserId);
		expect(getSessionId(tokenSession.passwordChangeUrl)).toBeTruthy();
		const { getPasswordChangeSession: adminSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{ input },
			adminHeaders(),
		);
		expect(adminSession.userId).toBe(targetUserId);
		expect(getSessionId(adminSession.passwordChangeUrl)).toBeTruthy();
	});

	it("rejects empty passwords and revokes existing sessions and links", async () => {
		const client = getGraphqlClient(url);
		const user = await registerPasswordUser(client);
		const otherUser = await registerPasswordUser(client);
		const accessLinkId = createTestAccessLink(user.userId, true);
		const otherAccessLinkId = createTestAccessLink(otherUser.userId);
		const { processAccessLink: accessLinkSession } = await client.request(
			ProcessAccessLinkDocument,
			{ input: { id: accessLinkId } },
		);
		if (accessLinkSession.__typename !== "ProcessAccessLinkResponse")
			throw new Error(
				"Expected an access-link session before password recovery",
			);
		const { loginUser: secondLogin } = await client.request(LoginUserDocument, {
			input: { password: { username: user.username, password: user.password } },
		});
		if (secondLogin.__typename !== "ApiKeyResponse") {
			throw new Error("Expected second login session");
		}
		const recoveryInput = { userId: user.userId };
		const { getPasswordChangeSession: firstSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{ input: recoveryInput },
			adminHeaders(),
		);
		const { getPasswordChangeSession: secondSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{
				input: {
					...recoveryInput,
					adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
				},
			},
		);
		const firstSessionId = getSessionId(firstSession.passwordChangeUrl);
		const secondSessionId = getSessionId(secondSession.passwordChangeUrl);
		expect(firstSessionId).toBeTruthy();
		expect(secondSessionId).toBeTruthy();

		await expect(
			client.request(SetPasswordViaSessionDocument, {
				input: { sessionId: firstSessionId, password: "" },
			}),
		).rejects.toThrow("Password must not be empty");

		const newPassword = faker.internet.password();
		const { setPasswordViaSession } = await client.request(
			SetPasswordViaSessionDocument,
			{ input: { sessionId: firstSessionId, password: newPassword } },
		);
		expect(setPasswordViaSession).toBe(true);
		for (const apiKey of [
			user.apiKey,
			secondLogin.apiKey,
			accessLinkSession.apiKey,
		]) {
			const { userDetails } = await client.request(
				UserDetailsDocument,
				{},
				{ Authorization: `Bearer ${apiKey}` },
			);
			expect(userDetails.__typename).toBe("UserDetailsError");
		}
		for (const sessionId of [firstSessionId, secondSessionId]) {
			await expect(
				client.request(SetPasswordViaSessionDocument, {
					input: { sessionId, password: faker.internet.password() },
				}),
			).rejects.toThrow("Password change session not found or expired");
		}
		const { processAccessLink: revokedLink } = await client.request(
			ProcessAccessLinkDocument,
			{ input: { id: accessLinkId } },
		);
		expect(revokedLink).toMatchObject({
			error: "REVOKED",
			__typename: "ProcessAccessLinkError",
		});
		const { processAccessLink: revokedDefaultLink } = await client.request(
			ProcessAccessLinkDocument,
			{ input: { username: user.username } },
		);
		expect(revokedDefaultLink).toMatchObject({
			error: "NOT_FOUND",
			__typename: "ProcessAccessLinkError",
		});
		const { processAccessLink: otherLink } = await client.request(
			ProcessAccessLinkDocument,
			{ input: { id: otherAccessLinkId } },
		);
		expect(otherLink.__typename).toBe("ProcessAccessLinkResponse");
		const { loginUser } = await client.request(LoginUserDocument, {
			input: { password: { username: user.username, password: newPassword } },
		});
		expect(loginUser.__typename).toBe("ApiKeyResponse");
		if (loginUser.__typename !== "ApiKeyResponse")
			throw new Error("Expected login with the new password");
		const { userAccessLinks } = await client.request(
			UserAccessLinksDocument,
			{},
			{ Authorization: `Bearer ${loginUser.apiKey}` },
		);
		expect(userAccessLinks).toContainEqual(
			expect.objectContaining({
				id: accessLinkId,
				isRevoked: true,
			}),
		);
	});

	it("allows only one competing completion of a recovery session", async () => {
		const client = getGraphqlClient(url);
		const user = await registerPasswordUser(client);
		const { getPasswordChangeSession } = await client.request(
			GetPasswordChangeSessionDocument,
			{ input: { userId: user.userId } },
			adminHeaders(),
		);
		const sessionId = getSessionId(getPasswordChangeSession.passwordChangeUrl);
		expect(sessionId).toBeTruthy();
		const attemptedPasswords = [
			faker.internet.password(),
			faker.internet.password(),
		];
		const completions = await Promise.allSettled(
			attemptedPasswords.map((password) =>
				client.request(SetPasswordViaSessionDocument, {
					input: { sessionId, password },
				}),
			),
		);
		const successfulIndexes = completions.flatMap((completion, index) =>
			completion.status === "fulfilled" ? [index] : [],
		);
		expect(successfulIndexes).toHaveLength(1);
		const successfulPassword = attemptedPasswords[successfulIndexes[0]];
		await expect(
			client.request(SetPasswordViaSessionDocument, {
				input: { sessionId, password: successfulPassword },
			}),
		).rejects.toThrow("Password change session not found or expired");
		const { loginUser } = await client.request(LoginUserDocument, {
			input: {
				password: { username: user.username, password: successfulPassword },
			},
		});
		expect(loginUser.__typename).toBe("ApiKeyResponse");
	});

	it("leaves reset users without a password until the recovery link is redeemed", async () => {
		const client = getGraphqlClient(url);
		const user = await registerPasswordUser(client);
		const accessLinkId = createTestAccessLink(user.userId, true);
		const { processAccessLink: accessLinkSession } = await client.request(
			ProcessAccessLinkDocument,
			{ input: { id: accessLinkId } },
		);
		if (accessLinkSession.__typename !== "ProcessAccessLinkResponse")
			throw new Error("Expected an access-link session before account reset");
		const { resetUser } = await client.request(
			ResetUserDocument,
			{ toResetUserId: user.userId },
			adminHeaders(),
		);
		expect(resetUser.__typename).toBe("UserResetResponse");

		const { loginUser } = await client.request(LoginUserDocument, {
			input: { password: { username: user.username, password: user.password } },
		});
		expect(loginUser).toMatchObject({
			__typename: "LoginError",
			error: "INCORRECT_PROVIDER_CHOSEN",
		});
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${user.apiKey}` },
		);
		expect(userDetails.__typename).toBe("UserDetailsError");
		const { userDetails: accessLinkUserDetails } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${accessLinkSession.apiKey}` },
		);
		expect(accessLinkUserDetails.__typename).toBe("UserDetailsError");
		for (const input of [{ id: accessLinkId }, { username: user.username }]) {
			const { processAccessLink } = await client.request(
				ProcessAccessLinkDocument,
				{ input },
			);
			expect(processAccessLink).toMatchObject({
				error: "NOT_FOUND",
				__typename: "ProcessAccessLinkError",
			});
		}
	});
});
