import { describe, expect, it } from "bun:test";
import { canUserRunScript } from "./access-control";

describe("canUserRunScript", () => {
	it("returns false when script is not found", () => {
		expect(canUserRunScript({ userId: "user-1", script: null })).toBe(false);
	});

	it("returns true for a built-in script regardless of userId", () => {
		expect(
			canUserRunScript({
				userId: "user-1",
				script: { userId: null, isBuiltin: true },
			}),
		).toBe(true);
	});

	it("returns true when the script is owned by the requesting user", () => {
		expect(
			canUserRunScript({
				userId: "user-1",
				script: { userId: "user-1", isBuiltin: false },
			}),
		).toBe(true);
	});

	it("returns false when the script is owned by a different user", () => {
		expect(
			canUserRunScript({
				userId: "user-1",
				script: { userId: "user-2", isBuiltin: false },
			}),
		).toBe(false);
	});

	it("returns true for a built-in script even when it has a non-null userId", () => {
		expect(
			canUserRunScript({
				userId: "user-1",
				script: { userId: "user-2", isBuiltin: true },
			}),
		).toBe(true);
	});
});
