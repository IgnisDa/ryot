import {
	UserCollectionsListDocument,
	UserDetailsDocument,
	UserImportReportsDocument,
	UserIntegrationsDocument,
	UserMeasurementsListDocument,
	UserMetadataListDocument,
	UserNotificationPlatformsDocument,
	UserWorkoutsListDocument,
	UserWorkoutTemplatesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient, registerTestUser } from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("User related tests", () => {
	const url = process.env.API_BASE_URL as string;
	let userApiKey: string;

	beforeAll(async () => {
		userApiKey = await registerTestUser(url);
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
		expect(userDetails.__typename).toBe("User");

		if (userDetails.__typename === "User") {
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
		const client = getGraphqlClient(url);
		const { userCollectionsList } = await client.request(
			UserCollectionsListDocument,
			{},
			getAuthHeaders(),
		);

		expect(userCollectionsList).toBeDefined();
		expect(userCollectionsList.response).toHaveLength(7);
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
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: {} },
			getAuthHeaders(),
		);

		expect(userMetadataList).toBeDefined();
		expect(userMetadataList.response.items).toHaveLength(0);
	});

	it("should have 0 workouts", async () => {
		const client = getGraphqlClient(url);
		const { userWorkoutsList } = await client.request(
			UserWorkoutsListDocument,
			{ input: { search: {} } },
			getAuthHeaders(),
		);

		expect(userWorkoutsList).toBeDefined();
		expect(userWorkoutsList.response.items).toHaveLength(0);
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
		const client = getGraphqlClient(url);
		const { userMeasurementsList } = await client.request(
			UserMeasurementsListDocument,
			{ input: {} },
			getAuthHeaders(),
		);

		expect(userMeasurementsList).toBeDefined();
		expect(userMeasurementsList).toHaveLength(0);
	});
});
