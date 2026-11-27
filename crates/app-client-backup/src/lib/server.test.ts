import { describe, expect, it } from "bun:test";

import { CLOUD_URL, resolveServerUrl } from "./server";

describe("resolveServerUrl", () => {
	it("returns the cloud URL regardless of the url argument when mode is cloud", () => {
		expect(resolveServerUrl("cloud", "")).toBe(CLOUD_URL);
		expect(resolveServerUrl("cloud", "https://self-hosted.example.com")).toBe(CLOUD_URL);
	});

	it("returns the trimmed url when mode is self-hosted", () => {
		expect(resolveServerUrl("self-hosted", "  https://example.com  ")).toBe("https://example.com");
	});

	it("strips a trailing slash from a self-hosted url", () => {
		expect(resolveServerUrl("self-hosted", "https://example.com/")).toBe("https://example.com");
	});

	it("strips trailing slash after trimming whitespace", () => {
		expect(resolveServerUrl("self-hosted", "  https://example.com/  ")).toBe("https://example.com");
	});

	it("preserves path segments in a self-hosted url", () => {
		expect(resolveServerUrl("self-hosted", "https://example.com/ryot")).toBe(
			"https://example.com/ryot",
		);
	});

	it("returns an empty string for a blank self-hosted url", () => {
		expect(resolveServerUrl("self-hosted", "   ")).toBe("");
	});
});
