import { describe, expect, it } from "vitest";

import { resolveEntityInterestSocketUrl } from "./entity-interest-socket";

describe("entity-interest WebSocket URL", () => {
	it("normalizes an HTTP origin and preserves its base path", () => {
		expect(resolveEntityInterestSocketUrl("  http://example.com/ryot///  ")).toBe(
			"ws://example.com/ryot/api/entity-interest/ws",
		);
	});

	it("uses WSS for an HTTPS origin", () => {
		expect(resolveEntityInterestSocketUrl("https://example.com/")).toBe(
			"wss://example.com/api/entity-interest/ws",
		);
	});

	it("removes credentials, query parameters, and fragments", () => {
		expect(
			resolveEntityInterestSocketUrl("https://user:secret@example.com/ryot?ticket=secret#part"),
		).toBe("wss://example.com/ryot/api/entity-interest/ws");
	});

	it("rejects non-HTTP server origins", () => {
		expect(() => resolveEntityInterestSocketUrl("file:///tmp/ryot")).toThrow(
			"Entity interest requires an HTTP or HTTPS server origin",
		);
	});
});
