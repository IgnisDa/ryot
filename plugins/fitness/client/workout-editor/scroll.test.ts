import { describe, expect, it } from "vitest";

import { editorScrollOffset } from "./scroll";

describe("workout target visibility", () => {
	it("moves a set clear of the header and floating dock", () => {
		expect(editorScrollOffset({ top: 80, bottom: 600, targetTop: 60, targetBottom: 120 })).toBe(
			-36,
		);
		expect(editorScrollOffset({ top: 80, bottom: 600, targetTop: 560, targetBottom: 640 })).toBe(
			56,
		);
	});

	it("keeps fully visible sets still and aligns oversized exercises with the top", () => {
		expect(editorScrollOffset({ top: 80, bottom: 600, targetTop: 100, targetBottom: 200 })).toBe(0);
		expect(editorScrollOffset({ top: 80, bottom: 600, targetTop: 200, targetBottom: 900 })).toBe(
			104,
		);
	});
});
