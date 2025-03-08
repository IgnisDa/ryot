import { describe, expect, it } from "bun:test";
import {
	buildBuiltinSavedViewName,
	resolveIsBuiltinProtected,
	resolveSavedViewName,
} from "./service";

describe("resolveSavedViewName", () => {
	it("trims the provided name", () => {
		expect(resolveSavedViewName("  My Saved View  ")).toBe("My Saved View");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveSavedViewName("   ")).toThrow(
			"Saved view name is required",
		);
	});
});

describe("buildBuiltinSavedViewName", () => {
	it("returns formatted name for entity schema", () => {
		expect(buildBuiltinSavedViewName("Whiskey")).toBe("All Whiskeys");
	});

	it("handles singular names correctly", () => {
		expect(buildBuiltinSavedViewName("Book")).toBe("All Books");
	});

	it("produces a naive double-s for names ending in 's' (known limitation)", () => {
		expect(buildBuiltinSavedViewName("Series")).toBe("All Seriess");
	});
});

describe("resolveIsBuiltinProtected", () => {
	it("returns protected true when isBuiltin is true", () => {
		expect(resolveIsBuiltinProtected(true)).toEqual({ protected: true });
	});

	it("returns protected false when isBuiltin is false", () => {
		expect(resolveIsBuiltinProtected(false)).toEqual({ protected: false });
	});
});
