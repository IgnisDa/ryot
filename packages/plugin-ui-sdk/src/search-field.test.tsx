import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { SearchField } from "./search-field";

const icons = { clearIcon: <span />, icon: <span data-testid="search-icon" /> };

describe("SearchField", () => {
	it("names the input from its label and reports every keystroke", () => {
		const changes: string[] = [];
		render(
			<SearchField
				{...icons}
				value=""
				label={testText("Search Items")}
				onChange={(value) => changes.push(value)}
			/>,
		);

		const input = screen.getByRole("searchbox", { name: "Search Items" });
		fireEvent.change(input, { target: { value: "du" } });

		expect(input.getAttribute("placeholder")).toBe("Search Items");
		expect(changes).toEqual(["du"]);
	});

	it("shows the shortcut hint only while empty and only when a shortcut is bound", () => {
		const view = render(
			<SearchField {...icons} value="" onChange={() => {}} label={testText("Search")} />,
		);
		expect(screen.queryByText("/")).toBeNull();

		view.rerender(
			<SearchField
				{...icons}
				value=""
				shortcut="/"
				onChange={() => {}}
				label={testText("Search")}
			/>,
		);
		expect(screen.getByText("/").getAttribute("aria-hidden")).toBe("true");

		view.rerender(
			<SearchField
				{...icons}
				value="du"
				shortcut="/"
				onChange={() => {}}
				label={testText("Search")}
			/>,
		);
		expect(screen.queryByText("/")).toBeNull();
	});

	it("clears through onChange once the field has a value", () => {
		const changes: string[] = [];
		const view = render(
			<SearchField
				{...icons}
				value=""
				label={testText("Search")}
				onChange={(value) => changes.push(value)}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

		view.rerender(
			<SearchField
				{...icons}
				value="sample"
				label={testText("Search")}
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
				value="sample"
				onChange={() => {}}
				label={testText("Search")}
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
		render(
			<SearchField
				{...icons}
				value=""
				shortcut="/"
				onChange={() => {}}
				label={testText("Search")}
			/>,
		);

		fireEvent.keyDown(document, { key: "/" });

		expect(document.activeElement).toBe(screen.getByRole("searchbox"));
	});

	it("clears on Escape while it holds a value and keeps focus", () => {
		const changes: string[] = [];
		render(
			<SearchField
				{...icons}
				value="sample"
				label={testText("Search")}
				onChange={(next) => changes.push(next)}
			/>,
		);
		const input = screen.getByRole("searchbox");
		input.focus();

		const defaultAllowed = fireEvent.keyDown(input, { key: "Escape" });

		expect(changes).toEqual([""]);
		expect(defaultAllowed).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it("blurs on Escape once it is empty and lets the event through", () => {
		const changes: string[] = [];
		render(
			<SearchField
				{...icons}
				value=""
				label={testText("Search")}
				onChange={(next) => changes.push(next)}
			/>,
		);
		const input = screen.getByRole("searchbox");
		input.focus();

		const defaultAllowed = fireEvent.keyDown(input, { key: "Escape" });

		expect(changes).toEqual([]);
		expect(defaultAllowed).toBe(true);
		expect(document.activeElement).not.toBe(input);
	});
});
