import { describe, expect, it } from "vitest";

import { CLOUD_URL, resolveServerUrl } from "./server";

describe("resolveServerUrl", () => {
	it("returns the cloud URL for cloud mode", () => {
		expect(resolveServerUrl("cloud", "https://self-hosted.example.com")).toBe(CLOUD_URL);
	});

	it("normalizes a self-hosted URL", () => {
		expect(resolveServerUrl("self-hosted", "  https://example.com/ryot/  ")).toBe(
			"https://example.com/ryot",
		);
	});

	it("returns an empty string for a blank self-hosted URL", () => {
		expect(resolveServerUrl("self-hosted", "   ")).toBe("");
	});
});
