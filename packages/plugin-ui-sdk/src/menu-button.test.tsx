import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

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

	it.each([
		["inline", "size-8"],
		["toolbar", "size-9"],
		["bar", "size-11"],
	] as const)(
		"renders a %s overflow trigger and shares it through the caller's ref",
		(trigger, size) => {
			const triggerRef = createRef<HTMLButtonElement>();
			render(
				<MenuButton
					trigger={trigger}
					label="More actions"
					triggerRef={triggerRef}
					items={[{ key: "one", label: "One", onSelect: () => {} }]}
				/>,
			);

			const button = screen.getByRole<HTMLButtonElement>("button", { name: "More actions" });
			expect(triggerRef.current).toBe(button);
			expect(button.querySelector("[data-app-icon]")?.getAttribute("data-app-icon")).toBe(
				"more-horizontal",
			);
			expect(button.classList.contains(size)).toBe(true);
		},
	);
});
