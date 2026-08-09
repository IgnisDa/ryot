import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
	it.each([
		["count", "rounded-pill bg-accent-soft px-1.5 py-px text-[11px] text-accent-text"],
		[
			"keyOnAccent",
			"rounded border border-accent-ink px-1.5 py-0.5 font-mono text-[11px] text-accent-ink",
		],
		[
			"key",
			"rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-muted",
		],
	] as const)("applies the %s variant classes", (variant, className) => {
		render(<Badge variant={variant}>0</Badge>);

		expect(screen.getByText("0").className).toBe(className);
	});

	it("defaults to the count variant and keeps caller classes", () => {
		render(<Badge className="ml-1">3</Badge>);

		expect(screen.getByText("3").className).toBe(
			"rounded-pill bg-accent-soft px-1.5 py-px text-[11px] text-accent-text ml-1",
		);
	});
});
