import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, StatusMessage } from "./index";

const classes = {
	text: "min-h-10 cursor-pointer font-semibold text-text-muted",
	switch:
		"min-h-9.5 cursor-pointer rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm",
	primary:
		"min-h-11 cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink",
	secondary:
		"min-h-11 cursor-pointer rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text",
} as const;

describe("Button", () => {
	it("renders a button and forwards its attributes", () => {
		render(
			<Button type="submit" disabled aria-label="Save">
				Save
			</Button>,
		);

		const button = screen.getByRole("button", { name: "Save" });
		expect(button.tagName).toBe("BUTTON");
		expect(button.getAttribute("type")).toBe("submit");
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	it.each([
		["text", classes.text],
		["switch", classes.switch],
		["primary", classes.primary],
		["secondary", classes.secondary],
	] as const)("applies the %s variant classes", (variant, className) => {
		render(<Button variant={variant}>{variant}</Button>);

		expect(screen.getByRole("button").className).toBe(className);
	});

	it("defaults to primary and merges className after variant classes", () => {
		render(<Button className="w-full">Continue</Button>);

		expect(screen.getByRole("button").className).toBe(`${classes.primary} w-full`);
	});
});

describe("StatusMessage", () => {
	it("renders an alert role with the danger token for the error tone", () => {
		render(<StatusMessage tone="error">Something failed</StatusMessage>);

		const message = screen.getByRole("alert");
		expect(message.className).toBe("text-danger");
		expect(message.textContent).toBe("Something failed");
	});

	it.each([
		["pending", "text-text-muted"],
		["success", "text-success"],
	] as const)("renders a status role with the %s tone", (tone, className) => {
		render(<StatusMessage tone={tone}>Message</StatusMessage>);

		const message = screen.getByRole("status");
		expect(message.className).toBe(className);
	});

	it("keeps one live region element across a tone change so content changes are announced", () => {
		const { rerender } = render(<StatusMessage tone="pending">Requesting...</StatusMessage>);
		const region = screen.getByRole("status");

		rerender(<StatusMessage tone="success">Hello, Ryot</StatusMessage>);
		expect(screen.getByRole("status")).toBe(region);
		expect(region.textContent).toBe("Hello, Ryot");

		rerender(<StatusMessage tone="error">Unavailable</StatusMessage>);
		expect(screen.getByRole("alert")).toBe(region);
	});

	it("merges className after the tone class", () => {
		render(
			<StatusMessage tone="success" className="mt-2">
				Done
			</StatusMessage>,
		);

		expect(screen.getByRole("status").className).toBe("text-success mt-2");
	});
});
