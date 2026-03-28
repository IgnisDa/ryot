import { describe, expect, it } from "vitest";

import { getNameFromEmail } from "./user-name";

describe("getNameFromEmail", () => {
	it.each([
		["jane@example.com", "Jane"],
		["jane.doe@example.com", "Jane Doe"],
		["jane_doe-smith@example.com", "Jane Doe Smith"],
		["@example.com", "New User"],
	])("derives a display name from %s", (email, expected) => {
		expect(getNameFromEmail(email)).toBe(expected);
	});
});
