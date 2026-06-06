import { describe, expect, it } from "vitest";

import { getActiveSettingsSection, settingsSections } from "./settings-sections";

describe("settings sections", () => {
	it("defines the settings navigation order and routes", () => {
		expect(settingsSections.map(({ href, label }) => [label, href])).toEqual([
			["General", "/settings/general"],
			["Integrations", "/settings/integrations"],
			["Notification channels", "/settings/notification-channels"],
			["Import data", "/settings/import-data"],
			["Account", "/settings/account"],
		]);
	});

	it.each([
		["/settings", "general"],
		["/media/settings/general", "general"],
		["/media/settings/integrations", "integrations"],
		["/settings/notification-channels", "notification-channels"],
		["/settings/import-data", "import-data"],
		["/settings/account", "account"],
	] as const)("resolves %s to %s", (pathname, expected) => {
		expect(getActiveSettingsSection(pathname)).toBe(expected);
	});
});
