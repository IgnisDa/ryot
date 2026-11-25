import { describe, expect } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import axe from "axe-core";
import { Effect } from "effect";
import { useState } from "react";

import { render } from "./i18n.test-support";
import { Select } from "./select";

const choices = [
	{ value: "default", label: testText("Provider default") },
	{ value: "es", hint: testText("es"), label: testText("Spanish") },
	{ value: "fr", hint: testText("fr"), label: testText("French") },
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
			label={testText("Metadata language")}
		/>
	);
}

const openOptions = () =>
	fireEvent.click(screen.getByRole("combobox", { name: "Metadata language: Provider default" }));

describe("Select", () => {
	it("names the trigger with the selected label and commits a choice on press", () => {
		render(<LanguageSelect />);
		openOptions();

		fireEvent.pointerDown(screen.getByRole("option", { name: "Spanish" }), {
			pointerType: "mouse",
		});
		fireEvent.click(screen.getByRole("option", { name: "Spanish" }));

		expect(screen.queryByRole("listbox")).toBeNull();
		expect(screen.getByRole("combobox", { name: "Metadata language: Spanish" })).toBeTruthy();
	});

	it("keeps the saved value while arrow keys move the highlight", () => {
		render(<LanguageSelect />);
		openOptions();

		fireEvent.keyDown(screen.getByRole("option", { name: "Provider default" }), {
			key: "ArrowDown",
		});

		expect(screen.getByRole("listbox")).toBeTruthy();
		expect(screen.getByRole("option", { name: "Spanish" }).getAttribute("aria-selected")).toBe(
			"false",
		);
	});

	it("marks only the selected choice as checked", () => {
		render(<LanguageSelect />);
		openOptions();

		expect(
			screen.getByRole("option", { name: "Provider default" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("option", { name: "French" }).getAttribute("aria-selected")).toBe(
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
