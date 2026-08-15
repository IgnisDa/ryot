import { describe, expect, it } from "vitest";

import { getActiveSettingsSection, settingsSections } from "./settings-sections";

describe("settings sections", () => {
	it("defines the settings navigation order and routes", () => {
		expect(settingsSections.map(({ href, label }) => [label, href])).toEqual([
			["Preferences", "/settings/preferences"],
			["Integrations", "/settings/integrations"],
			["Notification channels", "/settings/notification-channels"],
			["Import data", "/settings/import-data"],
			["Backups", "/settings/backups"],
			["Account", "/settings/account"],
		]);
	});

	it.each([
		["/settings", "preferences"],
		["/media/settings/preferences", "preferences"],
		["/media/settings/integrations", "integrations"],
		["/settings/notification-channels", "notification-channels"],
		["/settings/import-data", "import-data"],
		["/settings/import-data/run-1", "import-data"],
		["/media/settings/import-data/run-1", "import-data"],
		["/settings/backups", "backups"],
		["/settings/account-recovery", "preferences"],
		["/settings/account", "account"],
	] as const)("resolves %s to %s", (pathname, expected) => {
		expect(getActiveSettingsSection(pathname)).toBe(expected);
	});
});
