import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
	it("exposes a named progressbar with its value and maximum", () => {
		render(<ProgressBar max={120} value={36} tone="accent" label="Rest progress" />);

		const bar = screen.getByRole("progressbar", { name: "Rest progress" });
		expect(bar.getAttribute("aria-valuenow")).toBe("36");
		expect(bar.getAttribute("aria-valuemax")).toBe("120");
	});

	it.each([
		[-5, "0"],
		[150, "120"],
	])("clamps %i into the range", (value, expected) => {
		render(<ProgressBar max={120} tone="info" value={value} label="Set timer progress" />);

		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(expected);
	});

	it("applies the success tone and caller fill classes to the fill", () => {
		render(
			<ProgressBar max={10} value={5} label="Done" tone="success" fillClassName="duration-1000" />,
		);

		const fill = screen.getByRole("progressbar").firstElementChild;
		expect(fill?.className).toContain("bg-success");
		expect(fill?.className).toContain("duration-1000");
	});
});
