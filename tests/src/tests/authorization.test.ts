import {
	LoginUserDocument,
	RegisterUserDocument,
	UpdateUserDocument,
	UserDetailsDocument,
	UserLot,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	registerAdminUser,
	registerTestUser,
	TEST_ADMIN_ACCESS_TOKEN,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";
import {
	newCredentials,
	registerPasswordUser,
} from "../setup/authentication-fixtures";

describe("User authorization regressions", () => {
	const url = process.env.API_BASE_URL as string;
	let adminApiKey: string;

	beforeAll(async () => {
		[adminApiKey] = await registerAdminUser(url);
	});

	const adminHeaders = () => ({ Authorization: `Bearer ${adminApiKey}` });

	it("rejects anonymous registration with any explicit user lot", async () => {
		const client = getGraphqlClient(url);

		for (const lot of [UserLot.Normal, UserLot.Admin]) {
			const credentials = newCredentials();
			await expect(
				client.request(RegisterUserDocument, {
					input: { data: { password: credentials }, lot },
				}),
			).rejects.toThrow("Administrator authorization required");

			const { loginUser } = await client.request(LoginUserDocument, {
				input: { password: credentials },
			});
			expect(loginUser).toMatchObject({
				__typename: "LoginError",
				error: "USERNAME_DOES_NOT_EXIST",
			});
		}
	});

	it("allows the admin token and authenticated admin to choose registration lots", async () => {
		const client = getGraphqlClient(url);
		const tokenUser = await registerPasswordUser(client, {
			adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
			lot: UserLot.Admin,
		});
		const { userDetails: tokenUserDetails } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${tokenUser.apiKey}` },
		);
		expect(tokenUserDetails).toMatchObject({
			__typename: "UserDetails",
			id: tokenUser.userId,
			lot: UserLot.Admin,
		});

		const adminRegisteredUser = await registerPasswordUser(client, {
			headers: adminHeaders(),
			lot: UserLot.Normal,
		});
		const { userDetails: adminRegisteredDetails } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${adminRegisteredUser.apiKey}` },
		);
		expect(adminRegisteredDetails).toMatchObject({
			__typename: "UserDetails",
			id: adminRegisteredUser.userId,
			lot: UserLot.Normal,
		});
	});

	it("rejects self privilege changes but allows self-service updates", async () => {
		const client = getGraphqlClient(url);
		const [userApiKey, userId] = await registerTestUser(url);
		const headers = { Authorization: `Bearer ${userApiKey}` };
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			headers,
		);
		if (userDetails.__typename !== "UserDetails") {
			throw new Error("Expected normal user details");
		}
		await expect(
			client.request(
				UpdateUserDocument,
				{ input: { userId, lot: UserLot.Normal } },
				headers,
			),
		).rejects.toThrow("Administrator authorization required");
		await expect(
			client.request(
				UpdateUserDocument,
				{ input: { userId, isDisabled: false } },
				headers,
			),
		).rejects.toThrow("Administrator authorization required");
		await expect(
			client.request(
				UpdateUserDocument,
				{
					input: {
						userId,
						username: "forged-username",
						lot: UserLot.Admin,
						isDisabled: true,
						isOnboardingTourCompleted: true,
					},
				},
				headers,
			),
		).rejects.toThrow("Administrator authorization required");

		const { userDetails: unchangedDetails } = await client.request(
			UserDetailsDocument,
			{},
			headers,
		);
		expect(unchangedDetails).toMatchObject({
			__typename: "UserDetails",
			id: userId,
			name: userDetails.name,
			lot: UserLot.Normal,
			isDisabled: userDetails.isDisabled,
			extraInformation: userDetails.extraInformation,
		});

		const updatedUsername = `${userDetails.name}-updated`;
		await client.request(
			UpdateUserDocument,
			{
				input: {
					userId,
					username: updatedUsername,
					isOnboardingTourCompleted: true,
				},
			},
			headers,
		);
		const { userDetails: updatedDetails } = await client.request(
			UserDetailsDocument,
			{},
			headers,
		);
		expect(updatedDetails).toMatchObject({
			__typename: "UserDetails",
			id: userId,
			name: updatedUsername,
			lot: UserLot.Normal,
			isDisabled: userDetails.isDisabled,
			extraInformation: { isOnboardingTourCompleted: true },
		});
	});

	it("rejects a normal user's update to another account", async () => {
		const client = getGraphqlClient(url);
		const [attackerApiKey] = await registerTestUser(url);
		const [targetApiKey, targetUserId] = await registerTestUser(url);
		const headers = { Authorization: `Bearer ${attackerApiKey}` };
		const { userDetails: beforeUpdate } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${targetApiKey}` },
		);
		if (beforeUpdate.__typename !== "UserDetails") {
			throw new Error("Expected target user details");
		}

		await expect(
			client.request(
				UpdateUserDocument,
				{
					input: {
						userId: targetUserId,
						username: "attacker-controlled-name",
						isOnboardingTourCompleted: true,
					},
				},
				headers,
			),
		).rejects.toThrow("Administrator authorization required");
		const { userDetails: afterUpdate } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${targetApiKey}` },
		);
		expect(afterUpdate).toMatchObject({
			__typename: "UserDetails",
			id: targetUserId,
			name: beforeUpdate.name,
			lot: UserLot.Normal,
			isDisabled: beforeUpdate.isDisabled,
			extraInformation: beforeUpdate.extraInformation,
		});
	});

	it("requires an admin token or admin session for privileged user changes", async () => {
		const client = getGraphqlClient(url);
		const [, targetUserId] = await registerTestUser(url);
		const privilegedInput = { userId: targetUserId, lot: UserLot.Admin };

		await expect(
			client.request(UpdateUserDocument, { input: privilegedInput }),
		).rejects.toThrow("Administrator authorization required");
		for (const adminAccessToken of ["", "invalid-admin-token"]) {
			await expect(
				client.request(UpdateUserDocument, {
					input: { ...privilegedInput, adminAccessToken },
				}),
			).rejects.toThrow("Administrator authorization required");
		}

		const { updateUser } = await client.request(UpdateUserDocument, {
			input: {
				adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
				isDisabled: true,
				...privilegedInput,
			},
		});
		expect(updateUser.id).toBe(targetUserId);
		const { usersList } = await client.request(
			UsersListDocument,
			{},
			adminHeaders(),
		);
		expect(usersList).toContainEqual(
			expect.objectContaining({
				id: targetUserId,
				lot: UserLot.Admin,
				isDisabled: true,
			}),
		);

		await client.request(
			UpdateUserDocument,
			{
				input: {
					userId: targetUserId,
					lot: UserLot.Normal,
					isDisabled: false,
				},
			},
			adminHeaders(),
		);
		const { usersList: restoredUsers } = await client.request(
			UsersListDocument,
			{},
			adminHeaders(),
		);
		expect(restoredUsers).toContainEqual(
			expect.objectContaining({
				id: targetUserId,
				lot: UserLot.Normal,
				isDisabled: false,
			}),
		);
	});

	it("rejects forged OIDC login and registration for an existing account", async () => {
		const client = getGraphqlClient(url);
		const user = await registerPasswordUser(client);
		const forgedOidc = {
			oidc: { email: user.username, issuerId: user.userId },
		};

		await expect(
			client.request(LoginUserDocument, { input: forgedOidc }),
		).rejects.toThrow("verified authorization flow");
		await expect(
			client.request(RegisterUserDocument, {
				input: { data: forgedOidc },
			}),
		).rejects.toThrow("verified authorization flow");

		const { loginUser } = await client.request(LoginUserDocument, {
			input: { password: { username: user.username, password: user.password } },
		});
		expect(loginUser.__typename).toBe("ApiKeyResponse");
	});
});
