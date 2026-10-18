import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChipRadioGroup } from "./chip-radio-group";

const options = [
	{ value: "all", label: "All 4" },
	{ value: "cover", label: "Cover 2" },
	{ value: "logo", label: "Logo 2" },
] as const;

function Filter(props: { readonly overflow: "wrap" | "scroll" }) {
	const [value, setValue] = useState<undefined | (typeof options)[number]["value"]>("all");
	return (
		<ChipRadioGroup
			value={value}
			className="px-4"
			options={options}
			onChange={setValue}
			label="Filter images"
			overflow={props.overflow}
		/>
	);
}

describe("ChipRadioGroup", () => {
	it("checks the selected chip, names each radio by its label, and keeps a single tab stop", () => {
		render(<Filter overflow="scroll" />);

		expect(screen.getByRole("radiogroup", { name: "Filter images" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "All 4" }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radio", { name: "Cover 2" }).getAttribute("aria-checked")).toBe(
			"false",
		);
		expect(screen.getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toEqual([
			screen.getByRole("radio", { name: "All 4" }),
		]);
	});

	it("selects with arrow, Home, and End keys and moves the tab stop", () => {
		render(<Filter overflow="wrap" />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "All 4" }), { key: "ArrowRight" });
		const cover = screen.getByRole("radio", { name: "Cover 2" });
		expect(cover.getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(cover);
		expect(screen.getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toEqual([cover]);

		fireEvent.keyDown(cover, { key: "End" });
		expect(screen.getByRole("radio", { name: "Logo 2" }).getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(screen.getByRole("radio", { name: "Logo 2" }), { key: "Home" });
		expect(screen.getByRole("radio", { name: "All 4" }).getAttribute("aria-checked")).toBe("true");
	});

	it("selects on click", () => {
		render(<Filter overflow="scroll" />);

		fireEvent.click(screen.getByRole("radio", { name: "Logo 2" }));

		expect(screen.getByRole("radio", { name: "Logo 2" }).getAttribute("aria-checked")).toBe("true");
	});

	it("scrolls horizontally in a wrapper that takes the caller class", () => {
		render(<Filter overflow="scroll" />);

		const group = screen.getByRole("radiogroup");
		expect(group.classList.contains("w-max")).toBe(true);
		expect(group.parentElement?.classList.contains("overflow-x-auto")).toBe(true);
		expect(group.parentElement?.classList.contains("px-4")).toBe(true);
	});

	it("wraps onto further lines without a scroll wrapper", () => {
		render(<Filter overflow="wrap" />);

		const group = screen.getByRole("radiogroup");
		expect(group.classList.contains("flex-wrap")).toBe(true);
		expect(group.classList.contains("px-4")).toBe(true);
		expect(group.classList.contains("w-max")).toBe(false);
	});
});
