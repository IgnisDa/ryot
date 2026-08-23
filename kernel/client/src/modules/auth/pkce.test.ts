import { describe, expect, it } from "vitest";

import {
	deriveCodeChallenge,
	encodeBase64Url,
	generateOAuthRandomValue,
} from "#/modules/auth/pkce";

describe("OAuth PKCE", () => {
	it("uses unpadded URL-safe base64", () => {
		expect(encodeBase64Url(new Uint8Array([251, 255, 239]))).toBe("-__v");
		expect(generateOAuthRandomValue()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("derives the RFC 7636 S256 challenge", async () => {
		expect(await deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("derives the same challenge without WebCrypto, as on a plain-HTTP origin", async () => {
		const secure = globalThis.crypto;
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: { subtle: undefined, getRandomValues: secure.getRandomValues.bind(secure) },
		});
		try {
			expect(globalThis.crypto.subtle).toBeUndefined();
			expect(await deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
				"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			);
			expect(generateOAuthRandomValue()).toMatch(/^[A-Za-z0-9_-]{43}$/);
		} finally {
			Object.defineProperty(globalThis, "crypto", { configurable: true, value: secure });
		}
	});
});
