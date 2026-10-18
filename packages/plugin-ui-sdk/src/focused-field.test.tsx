import { describe, expect, it } from "@effect/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";

import { revealFocusedField, useFocusedFieldVisibility } from "./focused-field";

function Fields() {
	useFocusedFieldVisibility();
	return (
		<div data-testid="root" data-motion-scroll-root style={{ overflowY: "auto" }}>
			<div data-testid="header" data-scroll-obstruction="top" />
			<input aria-label="Weight" />
		</div>
	);
}

const bounds = (top: number, bottom: number) => new DOMRect(0, top, 300, bottom - top);

describe("focused field visibility", () => {
	it("reveals fields hidden below a scroll container or above its pinned header", () => {
		render(<Fields />);
		const root = screen.getByTestId("root");
		const field = screen.getByRole("textbox", { name: "Weight" });
		Object.assign(root, { getBoundingClientRect: () => bounds(0, 300) });
		Object.assign(screen.getByTestId("header"), { getBoundingClientRect: () => bounds(0, 60) });
		let top = 400;
		let height = 44;
		Object.assign(field, {
			getBoundingClientRect: () => bounds(top - root.scrollTop, top + height - root.scrollTop),
		});
		act(() => field.focus());
		revealFocusedField();
		expect(root.scrollTop).toBe(156);
		revealFocusedField();
		expect(root.scrollTop).toBe(156);
		top = 180;
		revealFocusedField();
		expect(root.scrollTop).toBe(108);
		top = 200;
		height = 400;
		revealFocusedField();
		expect(root.scrollTop).toBe(128);
		revealFocusedField();
		expect(root.scrollTop).toBe(128);
	});

	it.live(
		"reveals a focused field again after keyboard resize and removes listeners on unmount",
		() =>
			Effect.gen(function* () {
				const view = render(<Fields />);
				const root = screen.getByTestId("root");
				const field = screen.getByRole("textbox", { name: "Weight" });
				let bottom = 600;
				Object.assign(root, { getBoundingClientRect: () => bounds(0, bottom) });
				Object.assign(field, {
					getBoundingClientRect: () => bounds(400 - root.scrollTop, 444 - root.scrollTop),
				});
				act(() => field.focus());
				bottom = 300;
				fireEvent(window, new Event("resize"));
				yield* Effect.promise(() => waitFor(() => expect(root.scrollTop).toBe(156)));
				view.unmount();
				root.scrollTop = 0;
				fireEvent(window, new Event("resize"));
				expect(root.scrollTop).toBe(0);
			}),
	);

	it("does not scroll an inert background field", () => {
		render(<Fields />);
		const root = screen.getByTestId("root");
		const field = screen.getByRole("textbox", { name: "Weight" });
		Object.assign(root, { getBoundingClientRect: () => bounds(0, 300) });
		Object.assign(field, { getBoundingClientRect: () => bounds(400, 444) });
		act(() => field.focus());
		root.setAttribute("inert", "");
		revealFocusedField();
		expect(root.scrollTop).toBe(0);
	});
});
