import { describe, expect, it } from "vitest";

import { applyThemePreference, resolveTheme } from "#/modules/theme/preference";

describe("theme preference", () => {
	it("resolves system and explicit preferences", () => {
		expect(resolveTheme("system", "dark")).toBe("dark");
		expect(resolveTheme("light", "dark")).toBe("light");
	});

	it("applies explicit themes and removes the attribute for system mode", () => {
		const attributes = new Map<string, string>();
		const root = {
			removeAttribute: (name: string) => attributes.delete(name),
			setAttribute: (name: string, value: string) => attributes.set(name, value),
		};

		applyThemePreference(root, "dark");
		expect(attributes.get("data-theme")).toBe("dark");
		applyThemePreference(root, "system");
		expect(attributes.has("data-theme")).toBe(false);
	});
});
