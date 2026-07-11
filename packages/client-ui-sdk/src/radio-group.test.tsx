import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { RadioGroup } from "./radio-group";

const options = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
] as const;

function ThemeChoice(props: { readonly initial?: "light" | "dark" | "system" }) {
	const [value, setValue] = useState<"light" | "dark" | "system" | undefined>(props.initial);
	return (
		<RadioGroup
			value={value}
			options={options}
			label="Appearance"
			onChange={setValue}
			renderOption={(option, selected) => ({
				className: selected ? "border-accent" : "border-transparent",
				content: <span>{option.label}</span>,
			})}
		/>
	);
}

const radios = () => screen.getAllByRole("radio");
const tabStops = () => radios().filter((radio) => radio.tabIndex === 0);
const checked = () => radios().filter((radio) => radio.getAttribute("aria-checked") === "true");

describe("RadioGroup", () => {
	it("checks only the selected option and keeps a single tab stop on it", () => {
		render(<ThemeChoice initial="dark" />);

		screen.getByRole("radiogroup", { name: "Appearance" });
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
		expect(tabStops().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
	});

	it("puts the tab stop on the first option while nothing is selected", () => {
		render(<ThemeChoice />);

		expect(checked()).toEqual([]);
		expect(tabStops().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Light"]);
	});

	it("moves selection with the focus for both arrow axes and wraps around", () => {
		render(<ThemeChoice initial="light" />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "ArrowRight" });
		const dark = screen.getByRole("radio", { name: "Dark" });
		expect(dark.getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(dark);
		expect(tabStops()).toEqual([dark]);

		fireEvent.keyDown(dark, { key: "ArrowDown" });
		expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");

		fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowRight" });
		expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");

		fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "ArrowLeft" });
		expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");

		fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowUp" });
		expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
	});

	it("selects the first and last option on Home and End", () => {
		render(<ThemeChoice initial="dark" />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "End" });
		const system = screen.getByRole("radio", { name: "System" });
		expect(system.getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(system);

		fireEvent.keyDown(system, { key: "Home" });
		const light = screen.getByRole("radio", { name: "Light" });
		expect(light.getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(light);
	});

	it("ignores keys it does not own", () => {
		render(<ThemeChoice initial="dark" />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "Tab" });
		fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "a" });

		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
	});

	it("selects the clicked option", () => {
		render(<ThemeChoice initial="dark" />);

		fireEvent.click(screen.getByRole("radio", { name: "System" }));

		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["System"]);
	});

	it("passes an axe pass on the rendered group", async () => {
		const view = render(<ThemeChoice initial="dark" />);

		const results = await axe(view.container, { rules: { "color-contrast": { enabled: false } } });

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
