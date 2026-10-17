import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompletionToggle } from "./completion-toggle";

describe("CompletionToggle", () => {
	it("reports the complete variant's pressed state under a stable label", () => {
		const presses: Array<string> = [];
		const { rerender } = render(
			<CompletionToggle
				pressed={false}
				icon={<span />}
				variant="complete"
				label="Complete set 1"
				onClick={() => presses.push("press")}
			/>,
		);

		const toggle = screen.getByRole("button", { pressed: false, name: "Complete set 1" });
		fireEvent.click(toggle);
		expect(presses).toEqual(["press"]);

		rerender(
			<CompletionToggle pressed icon={<span />} variant="complete" label="Complete set 1" />,
		);
		expect(screen.getByRole("button", { pressed: true, name: "Complete set 1" })).toBe(toggle);
	});

	it("renders the start variant as a plain button", () => {
		render(
			<CompletionToggle
				pressed={false}
				variant="start"
				icon={<span />}
				label="Start set 1 timer"
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Start set 1 timer" }).hasAttribute("aria-pressed"),
		).toBe(false);
	});

	it("renders the include variant as a checkbox", () => {
		render(<CompletionToggle pressed icon={<span />} variant="include" label="Include set 2" />);

		expect(screen.getByRole("checkbox", { checked: true, name: "Include set 2" })).toBeTruthy();
	});
});
