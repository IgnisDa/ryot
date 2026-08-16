import { describe, expect, it } from "vitest";

import { IntegrationsGroup } from "./contract";

describe("webhook endpoint", () => {
	it("accepts every sink transport and encodes contract-client posts as JSON", () => {
		const accepted = [...IntegrationsGroup.endpoints.webhook.payload.keys()];

		expect(accepted).toEqual(["application/json", "multipart/form-data"]);
	});
});
