import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { clockFormat, Stepper } from "./stepper";

function RestStepper(props: { readonly initial: number | undefined }) {
	const [value, setValue] = useState(props.initial);
	return (
		<>
			<Stepper
				step={15}
				label="Rest"
				value={value}
				onChange={setValue}
				incrementIcon={<span />}
				decrementIcon={<span />}
				parse={clockFormat.parse}
				format={clockFormat.format}
			/>
			<output>{value === undefined ? "inherited" : String(value)}</output>
		</>
	);
}

const input = () => screen.getByRole("textbox", { name: "Rest" });
const output = () => screen.getByRole("status").textContent;

describe("Stepper", () => {
	it("steps with its buttons and clamps at the minimum", () => {
		render(<RestStepper initial={20} />);

		fireEvent.click(screen.getByRole("button", { name: "Increase Rest" }));
		expect(output()).toBe("35");
		expect(input().getAttribute("value")).toBe("0:35");

		fireEvent.click(screen.getByRole("button", { name: "Decrease Rest" }));
		fireEvent.click(screen.getByRole("button", { name: "Decrease Rest" }));
		fireEvent.click(screen.getByRole("button", { name: "Decrease Rest" }));
		expect(output()).toBe("0");
	});

	it("steps with Arrow keys and by four steps with Page keys", () => {
		render(<RestStepper initial={60} />);

		fireEvent.keyDown(input(), { key: "ArrowUp" });
		expect(output()).toBe("75");
		fireEvent.keyDown(input(), { key: "PageDown" });
		expect(output()).toBe("15");
		fireEvent.keyDown(input(), { key: "PageUp" });
		expect(output()).toBe("75");
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		expect(output()).toBe("60");
	});

	it("starts stepping from the minimum when empty", () => {
		render(<RestStepper initial={undefined} />);

		expect(input().getAttribute("value")).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Increase Rest" }));
		expect(output()).toBe("15");
	});

	it("parses typed minutes and seconds, keeps unparseable drafts, and clears to empty", () => {
		render(<RestStepper initial={60} />);

		fireEvent.change(input(), { target: { value: "2:05" } });
		expect(output()).toBe("125");
		fireEvent.change(input(), { target: { value: "2:" } });
		expect(output()).toBe("125");
		expect(input().getAttribute("value")).toBe("2:");
		fireEvent.blur(input());
		expect(input().getAttribute("value")).toBe("2:05");
		fireEvent.change(input(), { target: { value: "" } });
		expect(output()).toBe("inherited");
	});

	it.each([0, 5, 59, 60, 61, 90, 600, 3599])("round-trips %i seconds through m:ss", (seconds) => {
		expect(clockFormat.parse(clockFormat.format(seconds))).toBe(seconds);
	});
});
