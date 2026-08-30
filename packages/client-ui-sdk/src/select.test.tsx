import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { Select } from "./select";

const choices = [
	{ value: "default", label: "Provider default" },
	{ hint: "es", value: "es", label: "Spanish" },
	{ hint: "fr", value: "fr", label: "French" },
];

function LanguageSelect() {
	const [value, setValue] = useState("default");
	return (
		<Select
			value={value}
			checkIcon={null}
			choices={choices}
			chevronIcon={null}
			onChange={setValue}
			label="Metadata language"
		/>
	);
}

const openOptions = () =>
	fireEvent.click(screen.getByRole("button", { name: "Metadata language: Provider default" }));

describe("Select", () => {
	it("names the trigger with the selected label and commits a choice on press", () => {
		render(<LanguageSelect />);
		openOptions();

		fireEvent.click(screen.getByRole("radio", { name: "Spanish" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByRole("button", { name: "Metadata language: Spanish" })).toBeTruthy();
	});

	it("keeps the options open while arrow keys move the selection", () => {
		render(<LanguageSelect />);
		openOptions();

		fireEvent.keyDown(screen.getByRole("radio", { name: "Provider default" }), {
			key: "ArrowDown",
		});

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Spanish" }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});

	it("marks only the selected choice as checked", () => {
		render(<LanguageSelect />);
		openOptions();

		expect(
			screen.getByRole("radio", { name: "Provider default" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByRole("radio", { name: "French" }).getAttribute("aria-checked")).toBe(
			"false",
		);
	});

	it("passes an axe pass with its options modal open", async () => {
		render(<LanguageSelect />);
		openOptions();

		const results = await axe(document.body, {
			rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});
});
