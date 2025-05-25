import { describe, it, expect } from "vitest";

describe("Health Endpoint", () => {
	const url = process.env.API_BASE_URL;

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
});
