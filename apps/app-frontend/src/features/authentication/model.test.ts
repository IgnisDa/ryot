import { describe, expect, it } from "bun:test";
import { getNameFromEmail } from "./model";

describe("getNameFromEmail", () => {
	it("builds a display name from the email local part", () => {
		expect(getNameFromEmail("jane.doe@example.com")).toBe("Jane Doe");
	});

	it("falls back when the local part is empty", () => {
		expect(getNameFromEmail("@example.com")).toBe("New User");
	});
});
