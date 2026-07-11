import { render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { describe, expect, it } from "vitest";

import { completesEdgeGesture, EdgeGesture } from "#/modules/navigation/edge-gesture";

describe("EdgeGesture", () => {
	it("uses Motion's pixels-per-second velocity when deciding whether to commit", () => {
		expect(completesEdgeGesture(20, 300, 499)).toBe(false);
		expect(completesEdgeGesture(20, 300, 501)).toBe(true);
		expect(completesEdgeGesture(101, 300, 0)).toBe(true);
	});

	it("renders only when the kernel owns an available edge", () => {
		const progress = motionValue(0);
		const common = { progress, onBack: () => undefined, onOpenChange: () => undefined };
		const { rerender } = render(
			<EdgeGesture
				{...common}
				isOpen={false}
				edge={{ compact: true, intent: "back", owner: "plugin" }}
			/>,
		);
		expect(screen.queryByTestId("edge-gesture")).toBeNull();

		rerender(
			<EdgeGesture
				{...common}
				isOpen={false}
				edge={{ compact: true, intent: "back", owner: "kernel" }}
			/>,
		);
		expect(screen.getByTestId("edge-gesture")).toBeTruthy();

		rerender(
			<EdgeGesture
				{...common}
				isOpen={true}
				edge={{ compact: true, intent: "back", owner: "kernel" }}
			/>,
		);
		expect(screen.queryByTestId("edge-gesture")).toBeNull();
	});
});
