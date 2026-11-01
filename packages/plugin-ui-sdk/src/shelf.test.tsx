import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Shelf } from "./shelf";

const icons = { next: "›", previous: "‹" };

const renderShelf = (compact: boolean) =>
	render(
		<Shelf icons={icons} label="Continue" compact={compact}>
			<a href="#one">One</a>
			<a href="#two">Two</a>
			<a href="#three">Three</a>
		</Shelf>,
	);

describe("Shelf", () => {
	it("moves focus between items with arrow keys and stops at the ends", () => {
		renderShelf(false);
		const list = screen.getByRole("list", { name: "Continue" });
		const one = screen.getByRole("link", { name: "One" });
		const two = screen.getByRole("link", { name: "Two" });

		one.focus();
		fireEvent.keyDown(list, { key: "ArrowRight" });
		expect(document.activeElement).toBe(two);
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		fireEvent.keyDown(list, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(one);
	});

	it("omits paging controls in compact layouts", () => {
		renderShelf(true);
		expect(screen.queryByRole("button", { hidden: true, name: "Scroll forward" })).toBeNull();
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
	});
});
