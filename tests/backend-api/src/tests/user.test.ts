import {
	UserDetailsDocument,
	UserImportReportsDocument,
	UserIntegrationsDocument,
	UserNotificationPlatformsDocument,
	UserWorkoutTemplatesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	getUserCollectionsList,
	getUserMeasurementsList,
	getUserMetadataList,
	getUserWorkoutsList,
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
		const collections = await getUserCollectionsList(url, userApiKey);
		expect(collections).toHaveLength(7);
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
