import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppIcon } from "./icon";

describe("app icon", () => {
	it("renders a registered icon", () => {
		const { container } = render(<AppIcon size={24} name="film" className="fixture-icon" />);
		const icon = container.querySelector("svg");

		expect(icon?.getAttribute("data-app-icon")).toBe("film");
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		expect(icon?.getAttribute("class")).toContain("fixture-icon");
		expect(icon?.getAttribute("height")).toBe("24");
		expect(icon?.getAttribute("width")).toBe("24");
		expect(screen.queryByRole("img")).toBeNull();
	});

	it.each(["fixture", "test"])("renders the stable fallback for unknown %s icons", (name) => {
		const { container } = render(<AppIcon name={name} />);
		const icon = container.querySelector("svg");

		expect(icon?.getAttribute("data-app-icon")).toBe("fallback");
		expect(icon?.getAttribute("height")).toBe("16");
		expect(icon?.getAttribute("width")).toBe("16");
	});
});
