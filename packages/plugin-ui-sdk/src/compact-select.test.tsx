import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { Select } from "./select";

describe("compact Select", () => {
	it("shows the current choice and changes it from a compact listbox", () => {
		const changes: string[] = [];
		render(
			<Select
				value="day"
				checkIcon="✓"
				chevronIcon="▾"
				variant="compact"
				label={testText("Group by")}
				onChange={(value) => changes.push(value)}
				choices={[
					{ value: "day", label: testText("Day") },
					{ value: "week", label: testText("Week") },
				]}
			/>,
		);
		const trigger = screen.getByRole("combobox", { name: "Group by: Day" });
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const items = screen.getAllByRole("option");
		expect(items.map((item) => [item.textContent, item.getAttribute("aria-selected")])).toEqual([
			["Day✓", "true"],
			["Week", "false"],
		]);
		fireEvent.pointerDown(screen.getByRole("option", { name: "Week" }), { pointerType: "mouse" });
		fireEvent.click(screen.getByRole("option", { name: "Week" }));
		expect(changes).toEqual(["week"]);
		expect(screen.queryByRole("listbox")).toBeNull();
	});
});
