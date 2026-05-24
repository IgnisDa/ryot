import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./index";

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

	it.each(Object.entries(classes))("applies the %s variant classes", (variant, className) => {
		render(<Button variant={variant as keyof typeof classes}>{variant}</Button>);

		expect(screen.getByRole("button").className).toBe(className);
	});

	it("defaults to primary and merges className after variant classes", () => {
		render(<Button className="w-full">Continue</Button>);

		expect(screen.getByRole("button").className).toBe(`${classes.primary} w-full`);
	});
});
