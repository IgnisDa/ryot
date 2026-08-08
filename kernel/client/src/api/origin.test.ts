import { describe, expect, it } from "vitest";

import {
	CLOUD_ORIGIN,
	normalizeServerOrigin,
	parseServerOrigin,
	resolveServerOrigin,
	serverApiUrl,
} from "#/api/origin";

describe("server origins", () => {
	it("normalizes whitespace and trailing slashes", () => {
		expect(normalizeServerOrigin("  https://example.com/ryot///  ")).toBe(
			"https://example.com/ryot",
		);
	});

	it("resolves cloud independently of the entered value", () => {
		expect(resolveServerOrigin("cloud", "not a URL")).toEqual({
			ok: true,
			origin: CLOUD_ORIGIN,
		});
	});

	it("preserves a self-hosted base path and constructs its API URL", () => {
		const result = resolveServerOrigin("self-hosted", " https://example.com:8443/ryot/ ");
		expect(result).toEqual({ ok: true, origin: "https://example.com:8443/ryot" });
		if (result.ok) {
			expect(serverApiUrl(result.origin)).toBe("https://example.com:8443/ryot/api");
		}
	});

	it.each([
		"",
		"example.com",
		"ftp://example.com",
		"https://",
		"https://user@example.com",
		"https://example.com/path?query=1",
		"https://example.com/#fragment",
	])("rejects malformed or unsupported self-hosted origin %s", (value) => {
		expect(parseServerOrigin(value)).toEqual({ ok: false, reason: "invalid-server-origin" });
	});
});
