import { describe, expect, it } from "vitest";

import { IntegrationsGroup } from "./contract";
import { integrationWebhookUrl } from "./schemas";

describe("webhook endpoint", () => {
	it("builds the extension-compatible URL from the configured frontend origin", () => {
		expect(integrationWebhookUrl("https://ryot.example/", "token-1")).toBe(
			"https://ryot.example/_i/token-1",
		);
	});

	it("accepts every sink transport and encodes contract-client posts as JSON", () => {
		const accepted = [...IntegrationsGroup.endpoints.webhook.payload.keys()];

		expect(accepted).toEqual(["application/json", "multipart/form-data"]);
	});
});
