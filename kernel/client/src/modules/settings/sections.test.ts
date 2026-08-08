import { describe, expect, it } from "vitest";

import { activeSettingsSection } from "#/modules/settings/sections";

describe("activeSettingsSection", () => {
	it("matches an exact section path", () => {
		expect(activeSettingsSection("/settings/preferences")).toBe("preferences");
		expect(activeSettingsSection("/settings/account")).toBe("account");
	});

	it("keeps a nested path active under its parent section", () => {
		expect(activeSettingsSection("/settings/account/security")).toBe("account");
	});

	it("returns null for the settings index", () => {
		expect(activeSettingsSection("/settings")).toBeNull();
	});

	it("returns null for a non-settings path", () => {
		expect(activeSettingsSection("/fixture")).toBeNull();
	});
});
