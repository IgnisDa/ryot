import { describe, expect, it } from "bun:test";

import { testKernelText } from "@ryot-app/kernel-messages/testing";

import {
	normalizeCredentials,
	registrationName,
	validateEmail,
	validatePassword,
} from "#/modules/auth/form-values";

describe("authentication form values", () => {
	it("normalizes email without changing the password", () => {
		expect(normalizeCredentials({ password: " pass word ", email: "  USER@Example.COM " })).toEqual(
			{ password: " pass word ", email: "user@example.com" },
		);
		expect(registrationName("user@example.com")).toBe("user");
	});

	it("validates email and minimum password length", () => {
		expect(validateEmail(testKernelText, "user@example.com")).toBeUndefined();
		expect<string | undefined>(validateEmail(testKernelText, "user")).toBe(
			"Enter a valid email address.",
		);
		expect(validatePassword(testKernelText, "12345678")).toBeUndefined();
		expect<string | undefined>(validatePassword(testKernelText, "1234567")).toBe(
			"Password must be at least 8 characters.",
		);
	});
});
