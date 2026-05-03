import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthErrorMessage, logAuthError, reportAuthFailure, type AuthOperation } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("getAuthErrorMessage", () => {
	it.each<[AuthOperation, string, string]>([
		["sign-in", "INVALID_EMAIL_OR_PASSWORD", "The email or password is incorrect."],
		["sign-up", "USER_ALREADY_EXISTS", "An account already exists for this email."],
		["two-factor", "INVALID_CODE", "That authenticator code is invalid."],
		["two-factor", "INVALID_BACKUP_CODE", "That backup code is invalid."],
		["reset-password", "INVALID_TOKEN", "This password reset link is invalid or has expired."],
	])("maps %s code %s to application copy", (operation, code, expected) => {
		expect(getAuthErrorMessage(operation, { code, message: "internal detail" })).toBe(expected);
	});

	it.each<[AuthOperation, string]>([
		["oidc", "OpenID Connect sign-in failed."],
		["sign-in", "Could not sign in. Check your connection and try again."],
		["sign-up", "Could not create your account."],
		["two-factor", "That code could not be verified."],
		["reset-password", "Could not reset your password."],
	])("uses stable %s fallback copy", (operation, expected) => {
		expect(getAuthErrorMessage(operation, new Error("raw server failure"))).toBe(expected);
	});
});

describe("logAuthError", () => {
	it("logs only allowlisted diagnostic metadata", () => {
		const error = Object.assign(
			new Error(
				"request failed token=reset-secret password: hunter2 code='123456' cookie=session-secret",
			),
			{ code: "INVALID_TOKEN", status: 400 },
		);
		const consoleError = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);

		logAuthError("reset-password", error);

		expect(consoleError).toHaveBeenCalledWith("Authentication request failed", {
			kind: "exception",
			status: 400,
			code: "INVALID_TOKEN",
			operation: "reset-password",
		});
		expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
			/reset-secret|hunter2|123456|session-secret/,
		);
	});

	it.each([
		new Error(
			JSON.stringify({
				password: "json-password",
				token: "json-reset-token",
				auth: { code: "json-two-factor-code", cookie: "json-cookie" },
			}),
		),
		{
			code: "ADMIN_TOKEN_SECRET",
			message: "transport failed",
			status: "cookie=session-secret",
			request: {
				body: { password: "nested-password", token: "nested-reset-token" },
				headers: { cookie: "nested-cookie", "x-admin-token": "nested-admin-token" },
			},
		},
	])("does not log JSON-formatted or nested secrets", (cause) => {
		const consoleError = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);

		logAuthError("reset-password", cause);

		expect(consoleError).toHaveBeenCalledWith("Authentication request failed", {
			kind: cause instanceof Error ? "exception" : "response",
			operation: "reset-password",
		});
		expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
			/json-password|json-reset-token|json-two-factor-code|json-cookie|ADMIN_TOKEN_SECRET|session-secret|nested-password|nested-reset-token|nested-cookie|nested-admin-token/,
		);
	});
});

describe("reportAuthFailure", () => {
	it.each<[AuthOperation, string, string]>([
		["sign-in", "INVALID_EMAIL_OR_PASSWORD", "The email or password is incorrect."],
		["sign-up", "USER_ALREADY_EXISTS", "An account already exists for this email."],
		["two-factor", "INVALID_CODE", "That authenticator code is invalid."],
		["oidc", "OAUTH_ERROR", "OpenID Connect sign-in failed."],
		["reset-password", "INVALID_TOKEN", "This password reset link is invalid or has expired."],
	])("handles the %s response-error branch", (operation, code, expected) => {
		const consoleError = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);

		expect(reportAuthFailure(operation, { code, status: 400 })).toBe(expected);
		expect(consoleError).toHaveBeenCalledWith(
			"Authentication request failed",
			expect.objectContaining({ kind: "response", operation, status: 400 }),
		);
	});

	it.each<[AuthOperation, string]>([
		["sign-in", "Could not sign in. Check your connection and try again."],
		["sign-up", "Could not create your account."],
		["two-factor", "That code could not be verified."],
		["oidc", "OpenID Connect sign-in failed."],
		["reset-password", "Could not reset your password."],
	])("handles the %s thrown-failure branch", (operation, expected) => {
		const consoleError = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);

		expect(reportAuthFailure(operation, new Error("internal transport failure"))).toBe(expected);
		expect(consoleError).toHaveBeenCalledWith("Authentication request failed", {
			operation,
			kind: "exception",
		});
	});
});
