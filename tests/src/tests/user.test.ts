import { faker } from "@faker-js/faker";
import {
	ResetUserDocument,
	UserDetailsDocument,
	UserImportReportsDocument,
	UserIntegrationsDocument,
	UserNotificationPlatformsDocument,
	UserWorkoutTemplatesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	createCollection,
	DEFAULT_USER_COLLECTIONS_COUNT,
	getGraphqlClient,
	getUserCollectionsList,
	getUserMeasurementsList,
	getUserMetadataList,
	getUserWorkoutsList,
	registerAdminUser,
	registerTestUser,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("User related tests", () => {
	const url = process.env.API_BASE_URL as string;
	let userApiKey: string;

	beforeAll(async () => {
		[userApiKey] = await registerTestUser(url);
	});

	const getAuthHeaders = () => ({
		Authorization: `Bearer ${userApiKey}`,
	});

	it("should return defined UserPreferences", async () => {
		const client = getGraphqlClient(url);
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			getAuthHeaders(),
		);

		expect(userDetails).toBeDefined();
		expect(userDetails.__typename).toBe("UserDetails");

		if (userDetails.__typename === "UserDetails") {
			expect(userDetails.preferences).toBeDefined();
		}
	});

	it("should throw without authentication", async () => {
		const client = getGraphqlClient(url);

		await expect(client.request(UserDetailsDocument)).rejects.toThrow();
	});

	it("should return UserDetailsError with invalid token", async () => {
		const client = getGraphqlClient(url);
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			{
				Authorization: "Bearer invalid-token",
			},
		);

		expect(userDetails).toBeDefined();
		expect(userDetails.__typename).toBe("UserDetailsError");
	});

	it("should have 7 system-created collections", async () => {
		const collections = await getUserCollectionsList(url, userApiKey);
		expect(collections).toHaveLength(DEFAULT_USER_COLLECTIONS_COUNT);
	});

	it("should have 0 imports", async () => {
		const client = getGraphqlClient(url);
		const { userImportReports } = await client.request(
			UserImportReportsDocument,
			{},
			getAuthHeaders(),
		);

		expect(userImportReports).toBeDefined();
		expect(userImportReports).toHaveLength(0);
	});

	it("should have 0 integrations", async () => {
		const client = getGraphqlClient(url);
		const { userIntegrations } = await client.request(
			UserIntegrationsDocument,
			{},
			getAuthHeaders(),
		);

		expect(userIntegrations).toBeDefined();
		expect(userIntegrations).toHaveLength(0);
	});

	it("should have 0 notification platforms", async () => {
		const client = getGraphqlClient(url);
		const { userNotificationPlatforms } = await client.request(
			UserNotificationPlatformsDocument,
			{},
			getAuthHeaders(),
		);

		expect(userNotificationPlatforms).toBeDefined();
		expect(userNotificationPlatforms).toHaveLength(0);
	});

	it("should have 0 associated metadata", async () => {
		const metadata = await getUserMetadataList(url, userApiKey);
		expect(metadata).toHaveLength(0);
	});

	it("should have 0 workouts", async () => {
		const workouts = await getUserWorkoutsList(url, userApiKey);
		expect(workouts).toHaveLength(0);
	});

	it("should have 0 workout templates", async () => {
		const client = getGraphqlClient(url);
		const { userWorkoutTemplatesList } = await client.request(
			UserWorkoutTemplatesListDocument,
			{ input: { search: {} } },
			getAuthHeaders(),
		);

		expect(userWorkoutTemplatesList).toBeDefined();
		expect(userWorkoutTemplatesList.response.items).toHaveLength(0);
	});

	it("should have 0 measurements", async () => {
		const measurements = await getUserMeasurementsList(url, userApiKey);
		expect(measurements).toHaveLength(0);
	});
});

describe("Reset User functionality", () => {
	const url = process.env.API_BASE_URL as string;

	it("should successfully reset a password-based user", async () => {
		const client = getGraphqlClient(url);

		const [adminApiKey] = await registerAdminUser(url);
		const [targetUserApiKey, targetUserId] = await registerTestUser(url);

		const { userDetails: beforeReset } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${targetUserApiKey}` },
		);
		expect(beforeReset.__typename).toBe("UserDetails");
		const { resetUser } = await client.request(
			ResetUserDocument,
			{ toResetUserId: targetUserId },
			{ Authorization: `Bearer ${adminApiKey}` },
		);
		expect(resetUser.__typename).toBe("UserResetResponse");
		if (resetUser.__typename === "UserResetResponse") {
			expect(resetUser.passwordChangeUrl).toBeDefined();
			expect(typeof resetUser.passwordChangeUrl).toBe("string");
			expect(resetUser.passwordChangeUrl?.length).toBeGreaterThan(0);
		}
		const { userDetails: afterReset } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${targetUserApiKey}` },
		);
		expect(afterReset.__typename).toBe("UserDetails");
		const collectionsAfterReset = await getUserCollectionsList(
			url,
			targetUserApiKey,
		);
		expect(collectionsAfterReset).toHaveLength(DEFAULT_USER_COLLECTIONS_COUNT);
	});

	it("should fail when non-admin user tries to reset another user", async () => {
		const client = getGraphqlClient(url);
		const [user1ApiKey] = await registerTestUser(url);
		const [, user2Id] = await registerTestUser(url);
		await expect(
			client.request(
				ResetUserDocument,
				{ toResetUserId: user2Id },
				{ Authorization: `Bearer ${user1ApiKey}` },
			),
		).rejects.toThrow();
	});

	it("should return error when trying to reset non-existent user", async () => {
		const client = getGraphqlClient(url);
		const [adminApiKey] = await registerAdminUser(url);
		const nonExistentUserId = "usr_nonexistent123";

		await expect(
			client.request(
				ResetUserDocument,
				{ toResetUserId: nonExistentUserId },
				{ Authorization: `Bearer ${adminApiKey}` },
			),
		).rejects.toThrow("User not found");
	});

	it("should reset user data and create fresh default collections", async () => {
		const client = getGraphqlClient(url);
		const [adminApiKey] = await registerAdminUser(url);
		const [targetUserApiKey, targetUserId] = await registerTestUser(url);
		const initialCollections = await getUserCollectionsList(
			url,
			targetUserApiKey,
		);
		expect(initialCollections).toHaveLength(DEFAULT_USER_COLLECTIONS_COUNT);

		const additionalCollections = 2;
		for (let i = 0; i < additionalCollections; i++) {
			const collectionResult = await createCollection(
				url,
				targetUserApiKey,
				`Custom Collection ${i + 1}`,
				faker.lorem.sentence(),
			);
			expect(
				collectionResult.id,
				`Custom Collection ${i + 1} should be created successfully`,
			).toBeTruthy();
		}

		const collectionsWithCustom = await getUserCollectionsList(
			url,
			targetUserApiKey,
		);
		expect(collectionsWithCustom).toHaveLength(
			DEFAULT_USER_COLLECTIONS_COUNT + additionalCollections,
		);
		const { resetUser } = await client.request(
			ResetUserDocument,
			{ toResetUserId: targetUserId },
			{ Authorization: `Bearer ${adminApiKey}` },
		);

		expect(resetUser.__typename).toBe("UserResetResponse");
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			{ Authorization: `Bearer ${targetUserApiKey}` },
		);
		expect(userDetails.__typename).toBe("UserDetails");
		const collectionsAfterReset = await getUserCollectionsList(
			url,
			targetUserApiKey,
		);
		expect(collectionsAfterReset).toHaveLength(DEFAULT_USER_COLLECTIONS_COUNT);
	});
});
