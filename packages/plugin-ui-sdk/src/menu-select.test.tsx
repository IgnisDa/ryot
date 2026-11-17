import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { MenuSelect } from "./menu-select";

describe("MenuSelect", () => {
	it("shows the current choice and changes it from an anchored radio menu", () => {
		const changes: string[] = [];
		render(
			<MenuSelect
				value="day"
				checkIcon="✓"
				chevronIcon="▾"
				label={testText("Group by")}
				onChange={(value) => changes.push(value)}
				choices={[
					{ value: "day", label: testText("Day") },
					{ value: "week", label: testText("Week") },
				]}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Group by: Day" });
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const items = screen.getAllByRole("menuitemradio");
		expect(items.map((item) => [item.textContent, item.getAttribute("aria-checked")])).toEqual([
			["Day✓", "true"],
			["Week", "false"],
		]);
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Week" }));
		expect(changes).toEqual(["week"]);
		expect(screen.queryByRole("menu")).toBeNull();
	});
});
