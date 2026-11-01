import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { groupColorVariable } from "./group-colors";
import { Card } from "./surface";

describe("group colors", () => {
	it("names the solid and soft palette variables", () => {
		expect(groupColorVariable("teal")).toBe("var(--group-teal)");
		expect(groupColorVariable("teal", { soft: true })).toBe("var(--group-teal-soft)");
	});

	it("marks a card edge with its group color without dropping caller styles", () => {
		const { container } = render(<Card groupColor="orange" style={{ opacity: 0.5 }} />);
		const card = container.firstElementChild;

		expect(card?.getAttribute("style")).toContain("inset 3px 0 0 var(--group-orange)");
		expect(card?.getAttribute("style")).toContain("opacity: 0.5");
	});
});
