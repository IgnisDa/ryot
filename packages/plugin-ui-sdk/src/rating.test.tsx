import { describe, expect, it } from "bun:test";

import type { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import { fireEvent, render, screen } from "@testing-library/react";

import { RatingInput, RatingValue, useRatingDraft } from "./rating";

function DraftHarness(props: {
	readonly scale: RatingScale;
	readonly results: unknown[];
	readonly initial?: null | number;
}) {
	const rating = useRatingDraft(props.initial, props.scale);
	props.results.push(rating.result);
	return <RatingInput scale={props.scale} value={rating.draft} onChange={rating.setDraft} />;
}

describe("RatingValue", () => {
	it.each([
		["hundred", 66.66, "66.7 out of 100", "66.7 / 100"],
		["ten", 73, "7.3 out of 10", "7.3 / 10"],
		["three-point", 50, "Neutral", "😐 Neutral"],
	] as const)("shows a %s rating with an accessible label", (scale, rating, label, text) => {
		render(<RatingValue scale={scale} rating={rating} />);
		expect(screen.getByRole("img", { name: label }).textContent).toBe(text);
	});

	it("fills five stars to the nearest half", () => {
		render(<RatingValue rating={73} scale="five" />);
		const stars = screen.getByRole("img", { name: "3.7 out of 5 stars" });
		expect(
			Array.from(stars.querySelectorAll("[data-fill]"), (star) => star.getAttribute("data-fill")),
		).toEqual(["full", "full", "full", "half", "empty"]);
	});
});

describe("RatingInput", () => {
	it("picks half stars, stores multiples of ten, and clears the rating", () => {
		const results: unknown[] = [];
		render(<DraftHarness scale="five" results={results} />);
		expect(screen.getAllByRole("radio")).toHaveLength(10);
		fireEvent.click(screen.getByRole("radio", { name: "3.5 stars" }));
		expect(screen.getByRole("radio", { name: "3.5 stars" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(results.at(-1)).toEqual({ rating: 70, valid: true });
		fireEvent.keyDown(screen.getByRole("radio", { name: "3.5 stars" }), { key: "ArrowRight" });
		expect(results.at(-1)).toEqual({ rating: 80, valid: true });
		fireEvent.click(screen.getByRole("button", { name: "Clear rating" }));
		expect(results.at(-1)).toEqual({ valid: true, rating: null });
		expect(screen.queryByRole("button", { name: "Clear rating" })).toBeNull();
	});

	it("offers three labelled choices that store 0, 50, and 100", () => {
		const results: unknown[] = [];
		render(<DraftHarness initial={33.33} results={results} scale="three-point" />);
		expect(screen.getByRole("radiogroup", { name: "Rating (3-point, optional)" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Sad" }).getAttribute("aria-checked")).toBe("true");
		expect(results.at(-1)).toEqual({ valid: true, rating: 33.33 });
		fireEvent.click(screen.getByRole("radio", { name: "Neutral" }));
		expect(results.at(-1)).toEqual({ rating: 50, valid: true });
		fireEvent.click(screen.getByRole("radio", { name: "Happy" }));
		expect(results.at(-1)).toEqual({ valid: true, rating: 100 });
	});

	it("accepts whole numbers out of 100 and rejects out-of-range or fractional input", () => {
		const results: unknown[] = [];
		render(<DraftHarness scale="hundred" results={results} />);
		const input = screen.getByRole("textbox", { name: "Rating (out of 100, optional)" });
		fireEvent.change(input, { target: { value: "0" } });
		expect(results.at(-1)).toEqual({ rating: 0, valid: true });
		for (const value of ["101", "72.5", "-1", "abc"]) {
			fireEvent.change(input, { target: { value } });
			expect(results.at(-1)).toEqual({ valid: false });
		}
		expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 0 to 100.");
	});
});
