import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MenuButton } from "./menu-button";

describe("MenuButton", () => {
	it("restores focus to the trigger when Escape closes the menu", () => {
		render(
			<MenuButton label="Actions" items={[{ key: "one", label: "One", onSelect: () => {} }]} />,
		);
		const trigger = screen.getByRole("button", { name: "Actions" });

		fireEvent.click(trigger);
		expect(screen.getByRole("menu")).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("closes and runs the selected item through a custom trigger", () => {
		const selected: string[] = [];
		render(
			<MenuButton
				label="Actions"
				items={[{ key: "one", label: "One", onSelect: () => selected.push("one") }]}
				renderTrigger={(trigger) => (
					<button type="button" {...trigger}>
						Custom trigger
					</button>
				)}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Custom trigger" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "One" }));

		expect(screen.queryByRole("menu")).toBeNull();
		expect(selected).toEqual(["one"]);
	});
});
