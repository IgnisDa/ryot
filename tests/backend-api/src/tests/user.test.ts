import {
	UserCollectionsListDocument,
	UserDetailsDocument,
	UserImportReportsDocument,
	UserIntegrationsDocument,
	UserNotificationPlatformsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient, getGraphqlClientHeaders } from "src/utils";
import { describe, expect, it } from "vitest";

describe("User related tests", () => {
	const url = process.env.API_BASE_URL as string;

	it("should return defined UserPreferences", async () => {
		const client = getGraphqlClient(url);
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			getGraphqlClientHeaders(),
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
			getGraphqlClientHeaders(),
		);

		expect(userCollectionsList).toBeDefined();
		expect(userCollectionsList.response).toHaveLength(7);
	});

	it("should have 0 imports", async () => {
		const client = getGraphqlClient(url);
		const { userImportReports } = await client.request(
			UserImportReportsDocument,
			{},
			getGraphqlClientHeaders(),
		);

		expect(userImportReports).toBeDefined();
		expect(userImportReports).toHaveLength(0);
	});

	it("should have 0 integrations", async () => {
		const client = getGraphqlClient(url);
		const { userIntegrations } = await client.request(
			UserIntegrationsDocument,
			{},
			getGraphqlClientHeaders(),
		);

		expect(userIntegrations).toBeDefined();
		expect(userIntegrations).toHaveLength(0);
	});

	it("should have 0 notification platforms", async () => {
		const client = getGraphqlClient(url);
		const { userNotificationPlatforms } = await client.request(
			UserNotificationPlatformsDocument,
			{},
			getGraphqlClientHeaders(),
		);

		expect(userNotificationPlatforms).toBeDefined();
		expect(userNotificationPlatforms).toHaveLength(0);
	});
});
