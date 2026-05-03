import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { SectionNavList } from "./section-nav";
import type { SectionNavItem } from "./sections";

const sections = [
	{ icon: "house", slug: "general", label: "General", href: "/settings/general" },
	{ icon: "users", slug: "account", label: "Account", href: "/settings/account" },
	{ icon: "archive", slug: "backups", label: "Backups", href: "/settings/backups" },
] as const satisfies readonly SectionNavItem[];

describe("section navigation list", () => {
	it("renders sections, marks the active section, and reports selections", async () => {
		const user = userEvent.setup();
		const selected: SectionNavItem[] = [];
		await render(
			<SectionNavList
				showDisclosure
				active="account"
				sections={sections}
				onSelect={(section) => selected.push(section)}
			/>,
		);

		expect(screen.getByRole("button", { name: "General" })).not.toBeSelected();
		expect(screen.getByRole("button", { name: "Account" })).toBeSelected();

		await user.press(screen.getByRole("button", { name: "Backups" }));

		expect(selected.map((section) => section.slug)).toEqual(["backups"]);
	});
});
