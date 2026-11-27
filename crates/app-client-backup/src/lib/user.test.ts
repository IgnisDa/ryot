import { describe, expect, it } from "bun:test";

import { getNameFromEmail } from "./user";

describe("getNameFromEmail", () => {
	it("capitalizes a simple local part", () => {
		expect(getNameFromEmail("john@example.com")).toBe("John");
	});

	it("converts dots to spaces and capitalizes each word", () => {
		expect(getNameFromEmail("john.doe@example.com")).toBe("John Doe");
	});

	it("converts underscores to spaces and capitalizes each word", () => {
		expect(getNameFromEmail("john_doe@example.com")).toBe("John Doe");
	});

	it("converts hyphens to spaces and capitalizes each word", () => {
		expect(getNameFromEmail("john-doe@example.com")).toBe("John Doe");
	});

	it("collapses consecutive separators into a single space", () => {
		expect(getNameFromEmail("john..doe@example.com")).toBe("John Doe");
	});

	it("returns 'New User' when the local part is empty", () => {
		expect(getNameFromEmail("@example.com")).toBe("New User");
	});

	it("returns 'New User' for an empty string", () => {
		expect(getNameFromEmail("")).toBe("New User");
	});

	it("returns 'New User' when the local part is only separators", () => {
		expect(getNameFromEmail("..._@example.com")).toBe("New User");
	});

	it("preserves existing capitalisation in the local part", () => {
		expect(getNameFromEmail("Alice@example.com")).toBe("Alice");
	});
});
