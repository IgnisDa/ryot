import { describe, expect, it } from "bun:test";
import { getBackendUrl } from "../setup";

describe("Health endpoint", () => {
	it("should return healthy status", async () => {
		const url = getBackendUrl();
		const res = await fetch(`${url}/system/health`);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.data.status).toBe("healthy");
	});
});
