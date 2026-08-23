import { describe, expect, it } from "vitest";

import { ACTIVATION_DISTANCE, dragProgress, shouldCommit, shouldEngage } from "./gesture";

describe("shouldEngage", () => {
	it("engages once the drag clears the activation distance horizontally", () => {
		expect(shouldEngage({ dx: ACTIVATION_DISTANCE + 1, dy: 0 })).toBe(true);
	});

	it("ignores a drag that has not yet cleared the activation distance", () => {
		expect(shouldEngage({ dx: ACTIVATION_DISTANCE, dy: 0 })).toBe(false);
	});

	it("ignores a drag that is mostly vertical, leaving scrolling alone", () => {
		expect(shouldEngage({ dx: 10, dy: 24 })).toBe(false);
	});

	it("ignores a leftward drag", () => {
		expect(shouldEngage({ dx: -40, dy: 0 })).toBe(false);
	});
});

describe("shouldCommit", () => {
	it("commits past a third of the viewport", () => {
		expect(shouldCommit({ dx: 101, vx: 0, width: 300 })).toBe(true);
		expect(shouldCommit({ dx: 99, vx: 0, width: 300 })).toBe(false);
	});

	it("commits a short but fast flick", () => {
		expect(shouldCommit({ dx: 20, vx: 0.6, width: 300 })).toBe(true);
	});

	it("does not commit a short slow drag", () => {
		expect(shouldCommit({ dx: 20, vx: 0.4, width: 300 })).toBe(false);
	});
});

describe("dragProgress", () => {
	it("clamps to the unit range", () => {
		expect(dragProgress(150, 300)).toBe(0.5);
		expect(dragProgress(600, 300)).toBe(1);
		expect(dragProgress(-40, 300)).toBe(0);
	});

	it("reports no progress when the viewport has no measured width", () => {
		expect(dragProgress(120, 0)).toBe(0);
	});
});
