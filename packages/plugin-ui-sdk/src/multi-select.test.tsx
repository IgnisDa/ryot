import { describe, expect } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import axe from "axe-core";
import { Effect } from "effect";
import { useState } from "react";

import { render } from "./i18n.test-support";
import { MultiSelect } from "./select";

const choices = [
	{ value: "action", label: testText("Action") },
	{ value: "comedy", label: testText("Comedy") },
];

function DefaultIconSelect() {
	const [selected, setSelected] = useState<ReadonlyArray<"action" | "comedy">>([]);
	return (
		<MultiSelect
			selected={selected}
			onChange={setSelected}
			label={testText("Genres")}
			choices={[{ value: "action" }, { value: "comedy" }]}
		/>
	);
}

function GenreSelect(props: { readonly variant?: "chip" | "field" }) {
	const [selected, setSelected] = useState<ReadonlyArray<string>>(["action"]);
	return (
		<MultiSelect
			checkIcon={null}
			closeIcon={null}
			choices={choices}
			searchIcon={null}
			chevronIcon={null}
			selected={selected}
			onChange={setSelected}
			variant={props.variant}
			label={testText("Genres")}
		/>
	);
}

const openOptions = () => fireEvent.click(screen.getByRole("combobox", { name: "Genres" }));

describe("MultiSelect", () => {
	it("names the trigger clear and the picker clear distinctly", () => {
		render(<GenreSelect />);
		openOptions();

		expect(screen.getByRole("button", { name: "Clear Genres" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clear selections in Genres" })).toBeTruthy();
	});

	it("counts selections on a chip trigger that opens the same options", () => {
		render(<GenreSelect variant="chip" />);
		const chip = screen.getByRole("combobox", { name: "Genres" });
		expect(chip.textContent).toBe("Genres · 1");
		expect(screen.queryByRole("button", { name: "Clear Genres" })).toBeNull();

		openOptions();
		fireEvent.click(screen.getByRole("option", { name: "Comedy" }));

		expect(chip.textContent).toBe("Genres · 2");
	});

	it("clears the selection from inside the picker", () => {
		render(<GenreSelect />);
		openOptions();

		fireEvent.click(screen.getByRole("button", { name: "Clear selections in Genres" }));

		expect(screen.getByRole("option", { name: "Action" }).getAttribute("aria-selected")).toBe(
			"false",
		);
		expect(screen.queryByRole("button", { name: "Clear selections in Genres" })).toBeNull();
	});

	it.live(
		"passes an axe pass with its options open",
		() =>
			Effect.gen(function* () {
				render(<GenreSelect />);
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

	it("draws default icons and returns the choice value type", () => {
		const { container } = render(<DefaultIconSelect />);
		expect(container.querySelector("svg")).not.toBeNull();

		openOptions();
		fireEvent.click(screen.getByRole("option", { name: "action" }));

		expect(screen.getByRole("option", { name: "action" }).getAttribute("aria-selected")).toBe(
			"true",
		);
	});
});
