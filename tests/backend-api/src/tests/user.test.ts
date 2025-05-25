import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient } from "src/utils";
import { describe, expect, it } from "vitest";

describe("User Endpoint", () => {
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
});
