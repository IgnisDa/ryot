import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ImageTintOverlay } from "./tint";

const STOPS = ["#3D668F52", "#3D668F1F", "#3D668F00"] as const;

describe("ImageTintOverlay", () => {
	it("renders nothing without gradient stops", () => {
		const { container } = render(<ImageTintOverlay direction="vertical" />);

		expect(container.firstElementChild).toBeNull();
	});

	it("renders a top-to-bottom gradient for the vertical direction", () => {
		const { container } = render(<ImageTintOverlay direction="vertical" gradientStops={STOPS} />);
		const overlay = container.querySelector<HTMLElement>("[aria-hidden]");
		if (!overlay) {
			throw new Error("expected overlay element");
		}

		expect(overlay.getAttribute("aria-hidden")).toBe("true");
		expect(overlay.style.backgroundImage).toBe(
			"linear-gradient(rgba(61, 102, 143, 0.32) 0%, rgba(61, 102, 143, 0.12) 45%, rgba(61, 102, 143, 0) 100%)",
		);
	});

	it("renders a left-to-right gradient for the horizontal direction", () => {
		const { container } = render(<ImageTintOverlay direction="horizontal" gradientStops={STOPS} />);
		const overlay = container.querySelector<HTMLElement>("[aria-hidden]");
		if (!overlay) {
			throw new Error("expected overlay element");
		}

		expect(overlay.style.backgroundImage).toBe(
			"linear-gradient(to right, rgba(61, 102, 143, 0.32) 0%, rgba(61, 102, 143, 0.12) 45%, rgba(61, 102, 143, 0) 100%)",
		);
	});
});
