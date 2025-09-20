import { describe, expect, it } from "bun:test";

import { getBackendClient } from "../setup";

describe("Health endpoint", () => {
	it("should return healthy status", async () => {
		const client = getBackendClient();
		const { data, response } = await client.system.health();

		expect(response.status).toBe(200);
		expect(data?.status).toBe("healthy");
	});
});
