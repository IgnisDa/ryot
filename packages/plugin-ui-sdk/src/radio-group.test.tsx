import { describe, expect, it } from "@effect/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";
import { axe } from "vitest-axe";

import { RadioGroup } from "./radio-group";

const options = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
] as const;

function ThemeChoice(props: {
	readonly initial?: "light" | "dark" | "system";
	readonly disabled?: "light" | "dark" | "system";
}) {
	const [value, setValue] = useState<"light" | "dark" | "system" | undefined>(props.initial);
	return (
		<RadioGroup
			value={value}
			label="Appearance"
			onChange={setValue}
			options={options.map((option) =>
				Object.assign({}, option, { disabled: option.value === props.disabled }),
			)}
			renderOption={(option, selected) => ({
				content: <span>{option.label}</span>,
				className: selected ? "border-accent" : "border-transparent",
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

	it("never selects or focuses a disabled option", () => {
		render(<ThemeChoice initial="light" disabled="dark" />);
		const dark = screen.getByRole("radio", { name: "Dark" });
		expect(dark.getAttribute("aria-disabled")).toBe("true");

		fireEvent.click(dark);
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Light"]);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "ArrowRight" });
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["System"]);

		fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowLeft" });
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Light"]);
	});

	it("skips a disabled first or last option on Home and End", () => {
		render(<ThemeChoice initial="dark" disabled="system" />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "End" });
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
		cleanup();

		render(<ThemeChoice initial="dark" disabled="light" />);
		fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "Home" });
		expect(checked().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
	});

	it("keeps the tab stop off a disabled selected option", () => {
		render(<ThemeChoice initial="light" disabled="light" />);

		expect(tabStops().map((radio) => radio.getAttribute("aria-label"))).toEqual(["Dark"]);
	});

	it.live("passes an axe pass on the rendered group", () =>
		Effect.gen(function* () {
			const view = render(<ThemeChoice initial="dark" />);

			const results = yield* Effect.promise(() =>
				axe(view.container, { rules: { "color-contrast": { enabled: false } } }),
			);

			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);
});
