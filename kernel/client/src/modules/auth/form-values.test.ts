import { describe, expect, it } from "vitest";

import {
	normalizeCredentials,
	registrationName,
	validateEmail,
	validatePassword,
} from "./form-values";

describe("authentication form values", () => {
	it("normalizes email without changing the password", () => {
		expect(normalizeCredentials({ email: "  USER@Example.COM ", password: " pass word " })).toEqual(
			{ password: " pass word ", email: "user@example.com" },
		);
		expect(registrationName("user@example.com")).toBe("user");
	});

	it("validates email and minimum password length", () => {
		expect(validateEmail("user@example.com")).toBeUndefined();
		expect(validateEmail("user")).toBe("Enter a valid email address.");
		expect(validatePassword("12345678")).toBeUndefined();
		expect(validatePassword("1234567")).toBe("Password must be at least 8 characters.");
	});
});
