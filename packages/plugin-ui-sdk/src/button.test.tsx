import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
	it("renders a button and forwards its attributes", () => {
		render(
			<Button disabled type="submit" aria-label="Save">
				Save
			</Button>,
		);

		const button = screen.getByRole("button", { name: "Save" });
		expect(button.tagName).toBe("BUTTON");
		expect(button.getAttribute("type")).toBe("submit");
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	it.each(["text", "switch", "primary", "secondary"] as const)(
		"names the %s variant by its content",
		(variant) => {
			render(<Button variant={variant}>{variant}</Button>);

			expect(screen.getByRole("button", { name: variant })).toBeTruthy();
		},
	);

	it("keeps caller classes alongside the variant it defaults to", () => {
		render(<Button className="w-full">Continue</Button>);
		const fallback = screen.getByRole("button", { name: "Continue" });

		render(<Button variant="primary">Explicit</Button>);
		const explicit = screen.getByRole("button", { name: "Explicit" });

		expect(fallback.classList.contains("w-full")).toBe(true);
		expect(fallback.className).toBe(`${explicit.className} w-full`);
	});

	it("reports its pressed state to assistive technology through the switch variant", () => {
		render(
			<Button aria-pressed variant="switch">
				Compact
			</Button>,
		);

		expect(screen.getByRole("button", { pressed: true, name: "Compact" })).toBeTruthy();
	});
});
