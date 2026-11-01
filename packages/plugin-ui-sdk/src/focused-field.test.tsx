import { describe, expect, it } from "@effect/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";

import { revealFocusedField, revealOffset, useFocusedFieldVisibility } from "./focused-field";

function Fields() {
	useFocusedFieldVisibility();
	return (
		<div data-scroll-root data-testid="root" style={{ overflowY: "auto" }}>
			<div data-testid="header" data-scroll-obstruction="top" />
			<input aria-label="Value" />
		</div>
	);
}

const bounds = (top: number, bottom: number) => new DOMRect(0, top, 300, bottom - top);

describe("focused field visibility", () => {
	it("moves a target clear of the band edges and aligns oversized targets with the top", () => {
		const band = { top: 96, bottom: 584 };
		expect(revealOffset(band, { top: 60, bottom: 120 })).toBe(-36);
		expect(revealOffset(band, { top: 560, bottom: 640 })).toBe(56);
		expect(revealOffset(band, { top: 100, bottom: 200 })).toBe(0);
		expect(revealOffset(band, { top: 200, bottom: 900 })).toBe(104);
	});

	it.live(
		"reveals a focused field again after keyboard resize and removes listeners on unmount",
		() =>
			Effect.gen(function* () {
				const view = render(<Fields />);
				const root = screen.getByTestId("root");
				const field = screen.getByRole("textbox", { name: "Value" });
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
		const field = screen.getByRole("textbox", { name: "Value" });
		act(() => field.focus());
		root.setAttribute("inert", "");
		revealFocusedField();
		expect(root.scrollTop).toBe(0);
	});
});
