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

function GenreSelect(props: { readonly variant?: "chip" | "field" }) {
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
			variant={props.variant}
		/>
	);
}

function DefaultIconSelect() {
	const [selected, setSelected] = useState<ReadonlyArray<"action" | "comedy">>([]);
	return (
		<MultiSelect
			label="Genres"
			selected={selected}
			onChange={setSelected}
			choices={[{ value: "action" }, { value: "comedy" }]}
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

	it("counts selections on a chip trigger that opens the same options", () => {
		render(<GenreSelect variant="chip" />);
		const chip = screen.getByRole("button", { name: "Genres" });
		expect(chip.textContent).toBe("Genres · 1");
		expect(screen.queryByRole("button", { name: "Clear Genres" })).toBeNull();

		openOptions();
		fireEvent.click(screen.getByRole("checkbox", { name: "Comedy" }));

		expect(chip.textContent).toBe("Genres · 2");
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

	it("draws default icons and returns the choice value type", () => {
		const { container } = render(<DefaultIconSelect />);
		expect(container.querySelector("svg")).not.toBeNull();

		openOptions();
		fireEvent.click(screen.getByRole("checkbox", { name: "action" }));

		expect(screen.getByRole("checkbox", { name: "action" }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});
});
