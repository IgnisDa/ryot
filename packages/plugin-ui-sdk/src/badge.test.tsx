import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
	it("forwards its attributes so it can be hidden from assistive technology", () => {
		render(
			<Badge variant="key" aria-hidden="true" data-testid="shortcut">
				/
			</Badge>,
		);

		const badge = screen.getByTestId("shortcut");
		expect(badge.tagName).toBe("SPAN");
		expect(badge.textContent).toBe("/");
		expect(badge.getAttribute("aria-hidden")).toBe("true");
	});

	it("keeps caller classes alongside the variant it defaults to", () => {
		render(<Badge className="ml-1">3</Badge>);
		const fallback = screen.getByText("3");

		render(<Badge variant="count">4</Badge>);
		const explicit = screen.getByText("4");

		expect(fallback.classList.contains("ml-1")).toBe(true);
		expect(fallback.className).toBe(`${explicit.className} ml-1`);
	});
});
