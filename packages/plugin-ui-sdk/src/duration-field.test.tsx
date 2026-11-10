import { describe, expect, it } from "bun:test";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { type DurationDraft, durationDraft, DurationField, parseDuration } from "./duration-field";

function Duration(props: { readonly error?: string }) {
	const [value, setValue] = useState<DurationDraft>(durationDraft(95));
	return (
		<>
			<DurationField
				value={value}
				label="Time spent"
				onChange={setValue}
				error={props.error}
				hint="Leave empty if you don't know."
			/>
			<output>{String(parseDuration(value))}</output>
		</>
	);
}

describe("DurationField", () => {
	it("parses whole hours and nonnegative minutes, keeping zero distinct from missing", () => {
		expect(parseDuration({ hours: "2", minutes: "30" })).toBe(150);
		expect(parseDuration({ hours: "", minutes: "45.5" })).toBe(45.5);
		expect(parseDuration({ hours: "0", minutes: "0" })).toBe(0);
		expect(parseDuration({ hours: " ", minutes: "" })).toBeUndefined();
		expect(parseDuration({ minutes: "", hours: "1.5" })).toBeNull();
		expect(parseDuration({ hours: "", minutes: "-5" })).toBeNull();
		expect(durationDraft(61.25)).toEqual({ hours: "1", minutes: "1.25" });
		expect(durationDraft(undefined)).toEqual({ hours: "", minutes: "" });
	});

	it("edits hours and minutes as one value in minutes", () => {
		render(<Duration />);
		expect(screen.getByRole("textbox", { name: "Hours" })).toHaveProperty("value", "1");
		fireEvent.change(screen.getByRole("textbox", { name: "Minutes" }), { target: { value: "5" } });
		expect(screen.getByRole("status").textContent).toBe("65");
		expect(screen.getByText("Leave empty if you don't know.")).toBeDefined();
	});

	it("shows the error instead of the hint", () => {
		render(<Duration error="Enter whole hours and nonnegative minutes." />);
		expect(screen.getByRole("alert").textContent).toBe(
			"Enter whole hours and nonnegative minutes.",
		);
		expect(screen.queryByText("Leave empty if you don't know.")).toBeNull();
	});
});
