import { describe, expect, it } from "bun:test";

import { registerInternalAppRequestHandler } from "./internal-request";
import { getServer } from "./server";

registerInternalAppRequestHandler(null);

const app = getServer();
const frontendOrigin = process.env.FRONTEND_URL ?? "https://frontend.example.com";
const additionalOrigin =
	process.env.SERVER_CORS_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean)
		.find((origin) => origin !== frontendOrigin) ?? "https://studio.example.com";

describe("CORS", () => {
	it("adds CORS headers to allowed API responses", async () => {
		const response = await app.fetch(
			new Request("http://localhost/api/openapi.json", {
				headers: { origin: frontendOrigin },
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
		expect(response.headers.get("access-control-allow-credentials")).toBe("true");
	});

	it("allows preflight requests for CRUD routes and api keys", async () => {
		const response = await app.fetch(
			new Request("http://localhost/api/saved-views/example", {
				method: "OPTIONS",
				headers: {
					origin: additionalOrigin,
					"access-control-request-headers": "X-Api-Key, Content-Type",
					"access-control-request-method": "PUT",
				},
			}),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe(additionalOrigin);
		expect(response.headers.get("access-control-allow-credentials")).toBe("true");
		expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
		expect(response.headers.get("access-control-allow-headers")).toContain("X-Api-Key");
	});
});
