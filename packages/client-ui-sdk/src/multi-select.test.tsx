import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";
import { axe } from "vitest-axe";

import { MultiSelect } from "./multi-select";

const choices = [
	{ value: "action", label: "Action" },
	{ value: "comedy", label: "Comedy" },
];

function GenreSelect() {
	const [selected, setSelected] = useState<ReadonlyArray<string>>(["action"]);
	return (
		<MultiSelect
			label="Genres"
			checkIcon={null}
			closeIcon={null}
			choices={choices}
			searchIcon={null}
			chevronIcon={null}
			selected={selected}
			onChange={setSelected}
		/>
	);
}

const openOptions = () => fireEvent.click(screen.getByRole("button", { name: "Genres" }));

describe("MultiSelect", () => {
	it("names the trigger clear and the in-modal clear distinctly", () => {
		render(<GenreSelect />);
		openOptions();

		expect(screen.getByRole("button", { name: "Clear Genres" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clear selections in Genres" })).toBeTruthy();
	});

	it("clears the selection from inside the modal", () => {
		render(<GenreSelect />);
		openOptions();

		fireEvent.click(screen.getByRole("button", { name: "Clear selections in Genres" }));

		expect(screen.getByRole("checkbox", { name: "Action" }).getAttribute("aria-checked")).toBe(
			"false",
		);
		expect(screen.queryByRole("button", { name: "Clear selections in Genres" })).toBeNull();
	});

	it.live("passes an axe pass with its options modal open", () =>
		Effect.gen(function* () {
			render(<GenreSelect />);
			openOptions();

			const results = yield* Effect.promise(() =>
				axe(document.body, {
					rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
				}),
			);

			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);
});
