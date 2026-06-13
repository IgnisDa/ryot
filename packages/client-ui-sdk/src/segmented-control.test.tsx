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
