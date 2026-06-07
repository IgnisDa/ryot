import { describe, expect, it } from "bun:test";

import { getBackendClient } from "../fixtures";

describe("Health endpoint", () => {
	it("should return healthy status", async () => {
		const client = getBackendClient();
		const data = await client.run((c) => c.system.health());

		expect(data.status).toBe("healthy");
	});
});
