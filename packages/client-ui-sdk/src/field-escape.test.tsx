import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { useFieldEscape } from "./field-escape";

const handled = (event: KeyboardEvent) => event.preventDefault();

function Field(props: { readonly mounted: boolean }) {
	const input = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState("dune");
	useFieldEscape(input, { hasValue: value !== "", onClear: () => setValue("") });

	return (
		<>
			<p data-testid="value">{value}</p>
			{props.mounted && (
				<input
					ref={input}
					value={value}
					aria-label="Search"
					onChange={(event) => setValue(event.currentTarget.value)}
				/>
			)}
		</>
	);
}

const value = () => screen.getByTestId("value").textContent;

describe("useFieldEscape", () => {
	it("clears first, then blurs, and only consumes the press that cleared", () => {
		render(<Field mounted={true} />);
		const input = screen.getByRole("textbox");
		input.focus();

		const cleared = fireEvent.keyDown(input, { key: "Escape" });

		expect(value()).toBe("");
		expect(cleared).toBe(false);
		expect(document.activeElement).toBe(input);

		const blurred = fireEvent.keyDown(input, { key: "Escape" });

		expect(blurred).toBe(true);
		expect(document.activeElement).not.toBe(input);
	});

	it("binds a field that mounts after the first render", () => {
		const view = render(<Field mounted={false} />);
		view.rerender(<Field mounted={true} />);
		const input = screen.getByRole("textbox");
		input.focus();

		fireEvent.keyDown(input, { key: "Escape" });

		expect(value()).toBe("");
	});

	it("leaves other keys and already-handled presses alone", () => {
		render(<Field mounted={true} />);
		const input = screen.getByRole("textbox");

		fireEvent.keyDown(input, { key: "Enter" });

		expect(value()).toBe("dune");

		document.addEventListener("keydown", handled, { capture: true });
		fireEvent.keyDown(input, { key: "Escape" });
		document.removeEventListener("keydown", handled, { capture: true });

		expect(value()).toBe("dune");
	});
});
