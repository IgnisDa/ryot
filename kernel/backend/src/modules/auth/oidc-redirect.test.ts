import { describe, expect, it } from "@effect/vitest";

import {
	appendOidcRedirectToken,
	isSameOriginRelative,
	resolveOidcRedirectLocation,
} from "./oidc-redirect";

describe("isSameOriginRelative", () => {
	it("accepts a same-origin relative path", () => {
		expect(isSameOriginRelative("/auth/callback")).toBe(true);
	});

	it("rejects a protocol-relative location, which a browser reads as cross-origin", () => {
		expect(isSameOriginRelative("//evil.com/x")).toBe(false);
	});

	it("rejects absolute and custom-scheme locations", () => {
		expect(isSameOriginRelative("https://app.example.com/auth/callback")).toBe(false);
		expect(isSameOriginRelative("ryot://auth/callback")).toBe(false);
	});
});

describe("appendOidcRedirectToken", () => {
	it("appends the token to a relative web location with no existing query", () => {
		expect(appendOidcRedirectToken("/auth/callback", "abc123")).toBe("/auth/callback?token=abc123");
	});

	it("appends the token to a relative web location that already carries a redirect query", () => {
		expect(appendOidcRedirectToken("/auth/callback?redirect=%2Fsettings", "abc123")).toBe(
			"/auth/callback?redirect=%2Fsettings&token=abc123",
		);
	});

	it("appends the token to a custom-scheme location with no existing query", () => {
		expect(appendOidcRedirectToken("ryot://auth/callback", "abc123")).toBe(
			"ryot://auth/callback?token=abc123",
		);
	});

	it("appends the token to a custom-scheme location that already carries a redirect query", () => {
		expect(appendOidcRedirectToken("ryot://auth/callback?redirect=%2Fsettings", "abc123")).toBe(
			"ryot://auth/callback?redirect=%2Fsettings&token=abc123",
		);
	});

	it("keeps a fragment last so the token lands in the query the client reads", () => {
		expect(appendOidcRedirectToken("/auth/callback#section", "abc123")).toBe(
			"/auth/callback?token=abc123#section",
		);
		expect(
			new URL("https://ryot.test/auth/callback?token=abc123#section").searchParams.get("token"),
		).toBe("abc123");
	});

	it("keeps a fragment last when the location already carries a redirect query", () => {
		expect(appendOidcRedirectToken("ryot://auth/callback?redirect=%2Fsettings#x", "abc123")).toBe(
			"ryot://auth/callback?redirect=%2Fsettings&token=abc123#x",
		);
	});
});

const trustNothing = () => false;
const trustEverything = () => true;

describe("resolveOidcRedirectLocation", () => {
	it("leaves the location untouched when set-ott is absent, e.g. an OAuth error redirect", () => {
		expect(
			resolveOidcRedirectLocation({
				token: undefined,
				location: "/auth/callback",
				isTrustedOrigin: trustEverything,
			}),
		).toBe("/auth/callback");
	});

	it("leaves the location untouched when it is neither same-origin-relative nor a trusted origin", () => {
		expect(
			resolveOidcRedirectLocation({
				token: "abc123",
				isTrustedOrigin: trustNothing,
				location: "https://evil.com/auth/callback",
			}),
		).toBe("https://evil.com/auth/callback");
	});

	it("rejects a protocol-relative location even when isTrustedOrigin would otherwise allow it", () => {
		expect(
			resolveOidcRedirectLocation({
				token: "abc123",
				isTrustedOrigin: trustNothing,
				location: "//evil.com/auth/callback",
			}),
		).toBe("//evil.com/auth/callback");
	});

	it("appends the token for a same-origin relative location without consulting isTrustedOrigin", () => {
		expect(
			resolveOidcRedirectLocation({
				token: "abc123",
				isTrustedOrigin: trustNothing,
				location: "/auth/callback",
			}),
		).toBe("/auth/callback?token=abc123");
	});

	it("appends the token for a trusted custom-scheme origin", () => {
		expect(
			resolveOidcRedirectLocation({
				token: "abc123",
				location: "ryot://auth/callback",
				isTrustedOrigin: trustEverything,
			}),
		).toBe("ryot://auth/callback?token=abc123");
	});
});
