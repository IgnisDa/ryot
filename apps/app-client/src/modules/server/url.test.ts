import { describe, expect, it } from "vitest";

import {
	CLOUD_URL,
	normalizeServerOrigin,
	resolveApiUrl,
	resolveServerUrl,
	serverApiUrl,
} from "./url";

describe("server URL helpers", () => {
	it("normalizes the server origin and API base URL", () => {
		expect(normalizeServerOrigin("  https://example.com/ryot///  ")).toBe(
			"https://example.com/ryot",
		);
		expect(serverApiUrl("https://example.com/ryot/")).toBe("https://example.com/ryot/api");
	});

	it("resolves API-relative and absolute URLs", () => {
		expect(resolveApiUrl("https://example.com/ryot/", "/uploads/file?id=1")).toBe(
			"https://example.com/ryot/api/uploads/file?id=1",
		);
		expect(resolveApiUrl("https://example.com", "https://assets.example.com/file.jpg")).toBe(
			"https://assets.example.com/file.jpg",
		);
	});
});

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
