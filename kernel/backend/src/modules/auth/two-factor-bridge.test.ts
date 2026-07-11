import { describe, expect, it } from "@effect/vitest";

import {
	SET_TWO_FACTOR_TOKEN_HEADER,
	isTwoFactorVerifyPath,
	issuedChallenge,
	withExposedHeader,
} from "./two-factor-bridge";

const cookieName = "__Secure-better-auth.two_factor";

describe("isTwoFactorVerifyPath", () => {
	it("claims the verify paths and nothing else", () => {
		expect(isTwoFactorVerifyPath("/two-factor/verify-totp")).toBe(true);
		expect(isTwoFactorVerifyPath("/two-factor/verify-backup-code")).toBe(true);
		expect(isTwoFactorVerifyPath("/sign-in/email")).toBe(false);
		expect(isTwoFactorVerifyPath(undefined)).toBe(false);
	});
});

describe("issuedChallenge", () => {
	it("reads a freshly issued challenge out of the response cookies", () => {
		expect(
			issuedChallenge(`${cookieName}=2fa-abc.signature; Path=/; HttpOnly; Max-Age=600`, cookieName),
		).toBe("2fa-abc.signature");
	});

	it("ignores a cleared challenge so sign-out does not hand one back", () => {
		expect(issuedChallenge(`${cookieName}=; Path=/; Max-Age=0`, cookieName)).toBeUndefined();
	});

	it("ignores responses that set other cookies", () => {
		expect(
			issuedChallenge("__Secure-better-auth.session_token=abc; Path=/", cookieName),
		).toBeUndefined();
		expect(issuedChallenge(null, cookieName)).toBeUndefined();
	});
});

describe("withExposedHeader", () => {
	it("keeps the bearer plugin's own entry when adding the challenge header", () => {
		expect(withExposedHeader("set-auth-token", SET_TWO_FACTOR_TOKEN_HEADER)).toBe(
			"set-auth-token, set-two-factor-token",
		);
	});

	it("does not duplicate an entry that is already exposed", () => {
		expect(
			withExposedHeader("set-auth-token, set-two-factor-token", SET_TWO_FACTOR_TOKEN_HEADER),
		).toBe("set-auth-token, set-two-factor-token");
	});
});
