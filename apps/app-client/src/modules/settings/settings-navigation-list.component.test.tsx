import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { SettingsNavigationList } from "./settings-navigation-list";
import type { SettingsSection } from "./settings-sections";

describe("settings navigation list", () => {
	it("renders sections, marks the active section, and reports selections", async () => {
		const user = userEvent.setup();
		const selected: SettingsSection[] = [];
		await render(
			<SettingsNavigationList
				showDisclosure
				active="integrations"
				onSelect={(section) => selected.push(section)}
			/>,
		);

		expect(screen.getByRole("button", { name: "General" })).not.toBeSelected();
		expect(screen.getByRole("button", { name: "Integrations" })).toBeSelected();
		expect(screen.getByRole("button", { name: "Notification channels" })).toBeOnTheScreen();
		expect(screen.getByRole("button", { name: "Account" })).toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Import data" }));

		expect(selected.map((section) => section.slug)).toEqual(["import-data"]);
	});
});
