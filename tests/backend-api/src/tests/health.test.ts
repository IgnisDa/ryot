import { CoreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient } from "src/utils";
import { describe, expect, it } from "vitest";

describe("Health related tests", () => {
	const url = process.env.API_BASE_URL as string;

	it("should return 200 OK for /health endpoint", async () => {
		const response = await fetch(`${url}/health`);

		expect(response.status).toBe(200);
		expect(response.ok).toBe(true);
	});

	it("should return text content for /health endpoint", async () => {
		const response = await fetch(`${url}/health`);
		const text = await response.text();

		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(text).toBeTruthy();
		expect(text.length).toBeGreaterThan(0);
	});

	it("core details should be returned", async () => {
		const client = getGraphqlClient(url);
		const { coreDetails } = await client.request(CoreDetailsDocument);

		expect(coreDetails).toBeDefined();
	});
});
