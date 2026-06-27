import { describe, expect, it } from "vitest";

import { verifyAndSaveServer } from "./connect";

describe("server connection", () => {
	it("persists only after a healthy response", async () => {
		const saved: string[] = [];
		const failed = await verifyAndSaveServer("https://example.com", {
			checkHealth: () => Promise.reject(new Error("unhealthy")),
			saveServer: (origin) => saved.push(origin),
		});
		const succeeded = await verifyAndSaveServer("https://example.com", {
			checkHealth: () => Promise.resolve(),
			saveServer: (origin) => saved.push(origin),
		});

		expect(failed).toBe(false);
		expect(succeeded).toBe(true);
		expect(saved).toEqual(["https://example.com"]);
	});

	it("checks health again when retried", async () => {
		let attempts = 0;
		const operations = {
			checkHealth: () => {
				attempts += 1;
				return attempts === 1 ? Promise.reject(new Error("unreachable")) : Promise.resolve();
			},
			saveServer: () => undefined,
		};

		expect(await verifyAndSaveServer("https://example.com", operations)).toBe(false);
		expect(await verifyAndSaveServer("https://example.com", operations)).toBe(true);
		expect(attempts).toBe(2);
	});
});
