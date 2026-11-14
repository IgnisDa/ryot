import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import axe from "axe-core";
import { Effect } from "effect";
import { useState } from "react";

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

	it.live(
		"passes an axe pass with its options modal open",
		() =>
			Effect.gen(function* () {
				render(<LanguageSelect />);
				openOptions();

				const results = yield* Effect.promise(() =>
					axe.run(document.body, {
						rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
					}),
				);

				expect(results.violations.map((violation) => violation.id)).toEqual([]);
			}),
		testTimeout,
	);
});
