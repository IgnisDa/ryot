import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { StartedServices } from "../setup/testOrchestrator.js";
import {
	startAllServices,
	stopAllServices,
} from "../setup/testOrchestrator.js";

describe("Health Endpoint", () => {
	it("should return 200 OK for /health endpoint", async () => {
		const response = await fetch(`${services.caddyBaseUrl}/health`);

		expect(response.status).toBe(200);
		expect(response.ok).toBe(true);
	});

	it("should return text content for /health endpoint", async () => {
		const response = await fetch(`${services.caddyBaseUrl}/health`);
		const text = await response.text();

		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(text).toBeTruthy();
		expect(text.length).toBeGreaterThan(0);
	});

	it("should include backend config in health response", async () => {
		const response = await fetch(`${services.caddyBaseUrl}/health`);
		const text = await response.text();

		// The health endpoint includes backend config via httpInclude
		expect(text).toContain("config");
	});
});
