import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { AppSegmentedControl } from "./segmented-control";

const segments = [
	{ value: "grid", label: "Grid" },
	{ value: "list", label: "List" },
] as const;

describe("app segmented control", () => {
	it("presents choices as a radio group and reports the pressed value", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await render(
			<AppSegmentedControl
				value="grid"
				label="Layout"
				segments={segments}
				onChange={(value) => chosen.push(value)}
			/>,
		);

		expect(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "List" })).not.toBeChecked();

		await user.press(screen.getByRole("radio", { name: "List" }));

		expect(chosen).toEqual(["list"]);
	});

	it("switches to tab semantics with a selected state when asked", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await render(
			<AppSegmentedControl
				role="tab"
				value="list"
				label="Layout"
				segments={segments}
				onChange={(value) => chosen.push(value)}
			/>,
		);

		expect(screen.getByRole("tab", { name: "List" })).toBeSelected();
		expect(screen.getByRole("tab", { name: "Grid" })).not.toBeSelected();
		expect(screen.queryByRole("radio", { name: "Grid" })).not.toBeOnTheScreen();

		await user.press(screen.getByRole("tab", { name: "Grid" }));

		expect(chosen).toEqual(["grid"]);
	});

	it("refuses every segment while disabled", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await render(
			<AppSegmentedControl
				disabled
				value="grid"
				label="Layout"
				segments={segments}
				onChange={(value) => chosen.push(value)}
			/>,
		);

		expect(screen.getByRole("radio", { name: "List" })).toBeDisabled();

		await user.press(screen.getByRole("radio", { name: "List" }));

		expect(chosen).toEqual([]);
	});

	it("keeps its semantics and reporting when the segments fill the width", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await render(
			<AppSegmentedControl
				stretch
				role="tab"
				value="grid"
				label="Layout"
				segments={segments}
				onChange={(value) => chosen.push(value)}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Grid" })).toBeSelected();
		expect(screen.getByRole("tab", { name: "List" })).toBeEnabled();

		await user.press(screen.getByRole("tab", { name: "List" }));

		expect(chosen).toEqual(["list"]);
	});

	it("marks nothing as chosen until a value matches a segment", async () => {
		await render(
			<AppSegmentedControl
				label="Layout"
				value={undefined}
				segments={segments}
				onChange={() => undefined}
			/>,
		);

		expect(screen.getByRole("radio", { name: "Grid" })).not.toBeChecked();
		expect(screen.getByRole("radio", { name: "List" })).not.toBeChecked();
	});
});
