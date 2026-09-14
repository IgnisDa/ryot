import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SegmentedControl } from "./segmented-control";

const options = [
	{ value: "grid", label: "Grid view", content: <span data-testid="grid-icon" /> },
	{ value: "list", label: "List view", content: <span data-testid="list-icon" /> },
] as const;

describe("SegmentedControl", () => {
	it("checks only the selected option and names icon-only options by their label", () => {
		render(
			<SegmentedControl
				value="grid"
				options={options}
				onChange={() => {}}
				label="Saved view layout"
			/>,
		);

		const group = screen.getByRole("radiogroup", { name: "Saved view layout" });
		expect(group.contains(screen.getByTestId("grid-icon"))).toBe(true);
		expect(screen.getByRole("radio", { name: "Grid view" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe(
			"false",
		);
	});

	it("keeps one tab stop and reports arrow and Home/End moves as selections", () => {
		const selected: string[] = [];
		render(
			<SegmentedControl
				value="grid"
				options={options}
				label="Saved view layout"
				onChange={(value) => selected.push(value)}
			/>,
		);

		const grid = screen.getByRole("radio", { name: "Grid view" });
		expect(screen.getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toEqual([grid]);

		fireEvent.keyDown(grid, { key: "ArrowRight" });
		fireEvent.keyDown(grid, { key: "End" });
		fireEvent.keyDown(grid, { key: "Home" });

		expect(selected).toEqual(["list", "list", "grid"]);
	});

	it("reports the clicked value", () => {
		const selected: string[] = [];
		render(
			<SegmentedControl
				value="grid"
				options={options}
				label="Saved view layout"
				onChange={(value) => selected.push(value)}
			/>,
		);

		const list = screen.getByRole("radio", { name: "List view" });
		fireEvent.click(list);

		expect(selected).toEqual(["list"]);
	});
});
