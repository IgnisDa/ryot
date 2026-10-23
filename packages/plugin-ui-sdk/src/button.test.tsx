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

	it.each(["ghost", "switch", "danger", "outline", "primary", "secondary", "dangerGhost"] as const)(
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

	it("blocks activation and reports busy while loading", () => {
		render(<Button loading>Save changes</Button>);

		const button = screen.getByRole("button", { name: "Save changes" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");
	});

	it.each([
		["link", "text-accent-text"],
		["linkPlain", "text-text"],
	] as const)(
		"renders the %s variant as a plain-text button with only its tone, touch and disabled classes",
		(variant, tone) => {
			render(
				<Button size="lg" variant={variant}>
					Open
				</Button>,
			);

			expect(screen.getByRole("button", { name: "Open" }).className).toBe(
				`font-ui font-medium text-[13px] ${tone} pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50`,
			);
		},
	);

	it("defaults the link variants to a non-submitting button that an explicit type overrides", () => {
		render(
			<>
				<Button variant="link">Plain</Button>
				<Button variant="linkPlain">Plain tone</Button>
				<Button type="submit" variant="link">
					Submit
				</Button>
				<Button>Primary</Button>
			</>,
		);

		expect(screen.getByRole("button", { name: "Plain" }).getAttribute("type")).toBe("button");
		expect(screen.getByRole("button", { name: "Plain tone" }).getAttribute("type")).toBe("button");
		expect(screen.getByRole("button", { name: "Submit" }).getAttribute("type")).toBe("submit");
		expect(screen.getByRole("button", { name: "Primary" }).hasAttribute("type")).toBe(false);
	});
});
