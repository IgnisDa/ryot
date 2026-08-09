import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, StatusMessage } from "./index";

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
			<Button variant="switch" aria-pressed>
				Compact
			</Button>,
		);

		expect(screen.getByRole("button", { name: "Compact", pressed: true })).toBeTruthy();
	});
});

describe("StatusMessage", () => {
	it("announces the error tone as an alert", () => {
		render(<StatusMessage tone="error">Something failed</StatusMessage>);

		expect(screen.getByRole("alert").textContent).toBe("Something failed");
	});

	it.each(["pending", "success"] as const)("announces the %s tone as a status", (tone) => {
		render(<StatusMessage tone={tone}>Message</StatusMessage>);

		expect(screen.getByRole("status").textContent).toBe("Message");
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

	it("keeps caller classes", () => {
		render(
			<StatusMessage tone="success" className="mt-2">
				Done
			</StatusMessage>,
		);

		expect(screen.getByRole("status").classList.contains("mt-2")).toBe(true);
	});
});
