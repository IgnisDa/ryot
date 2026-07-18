import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchField } from "./search-field";

const icons = { icon: <span data-testid="search-icon" />, clearIcon: <span /> };

describe("SearchField", () => {
	it("names the input from its label and reports every keystroke", () => {
		const changes: string[] = [];
		render(
			<SearchField
				{...icons}
				value=""
				label="Search Books"
				onChange={(value) => changes.push(value)}
			/>,
		);

		const input = screen.getByRole("searchbox", { name: "Search Books" });
		fireEvent.change(input, { target: { value: "du" } });

		expect(input.getAttribute("placeholder")).toBe("Search Books");
		expect(changes).toEqual(["du"]);
	});

	it("shows the shortcut hint only while empty and only when a shortcut is bound", () => {
		const view = render(<SearchField {...icons} value="" label="Search" onChange={() => {}} />);
		expect(screen.queryByText("/")).toBeNull();

		view.rerender(
			<SearchField {...icons} value="" label="Search" shortcut="/" onChange={() => {}} />,
		);
		expect(screen.getByText("/").getAttribute("aria-hidden")).toBe("true");

		view.rerender(
			<SearchField {...icons} value="du" label="Search" shortcut="/" onChange={() => {}} />,
		);
		expect(screen.queryByText("/")).toBeNull();
	});

	it("clears through onChange once the field has a value", () => {
		const changes: string[] = [];
		const view = render(
			<SearchField {...icons} value="" label="Search" onChange={(value) => changes.push(value)} />,
		);
		expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

		view.rerender(
			<SearchField
				{...icons}
				value="dune"
				label="Search"
				onChange={(value) => changes.push(value)}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

		expect(changes).toEqual([""]);
	});

	it("submits without navigating away", () => {
		let submits = 0;
		render(
			<SearchField
				{...icons}
				value="dune"
				label="Search"
				onChange={() => {}}
				onSubmit={() => {
					submits += 1;
				}}
			/>,
		);

		const submitted = fireEvent.submit(screen.getByRole("search"));

		expect(submits).toBe(1);
		expect(submitted).toBe(false);
	});

	it("focuses itself when its shortcut is pressed", () => {
		render(<SearchField {...icons} value="" label="Search" shortcut="/" onChange={() => {}} />);

		fireEvent.keyDown(document, { key: "/" });

		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
	});
});
