import { describe, expect, it } from "vitest";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import { resolveIntegrationLot, validateProgressThresholds } from "./service";

describe("resolveIntegrationLot", () => {
	const registered = {
		lot: "sink",
		name: "Plex",
		slug: "plex_yank",
		pluginSlug: "media",
		scriptSlug: "media.plex",
		description: "Plex sink",
		settingsSchema: { fields: {} },
	} satisfies RegisteredIntegrationProvider;

	it("prefers the registry lot over the hardcoded table", () => {
		expect(resolveIntegrationLot(() => registered, "plex_yank")).toBe("sink");
	});

	it("falls back to the hardcoded table when the registry does not know the provider", () => {
		expect(resolveIntegrationLot(() => null, "plex_yank")).toBe("yank");
	});
});

describe("validateProgressThresholds", () => {
	it("returns null for valid thresholds", () => {
		expect(validateProgressThresholds(2, 95)).toBeNull();
		expect(validateProgressThresholds(0, 100)).toBeNull();
		expect(validateProgressThresholds(50, 50)).toBeNull();
	});

	it("rejects minimumProgress below 0", () => {
		expect(validateProgressThresholds(-1, 95)).toMatch(/minimumProgress/);
	});

	it("rejects minimumProgress above 100", () => {
		expect(validateProgressThresholds(101, 101)).toMatch(/minimumProgress/);
	});

	it("rejects maximumProgress above 100", () => {
		expect(validateProgressThresholds(2, 101)).toMatch(/maximumProgress/);
	});

	it("rejects minimum greater than maximum", () => {
		expect(validateProgressThresholds(96, 95)).toMatch(/minimumProgress must not exceed/);
	});
});
