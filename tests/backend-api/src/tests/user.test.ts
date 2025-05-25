import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient } from "src/utils";
import { describe, expect, it } from "vitest";

describe("User related tests", () => {
	const url = process.env.API_BASE_URL as string;

	it("should return defined UserPreferences", async () => {
		const client = getGraphqlClient(url);
		const { userDetails } = await client.request(
			UserDetailsDocument,
			{},
			{
				Authorization: `Bearer ${process.env.USER_API_KEY}`,
			},
		);

		expect(userDetails).toBeDefined();
		expect(userDetails.__typename).toBe("User");

		if (userDetails.__typename === "User") {
			expect(userDetails.preferences).toBeDefined();
		}
	});

	it("should fail without authentication", async () => {
		const client = getGraphqlClient(url);

		await expect(client.request(UserDetailsDocument)).rejects.toThrow();
	});

	it("should fail with invalid token", async () => {
		const client = getGraphqlClient(url);

		await expect(
			client.request(
				UserDetailsDocument,
				{},
				{
					Authorization: "Bearer invalid-token",
				},
			),
		).rejects.toThrow();
	});
});
