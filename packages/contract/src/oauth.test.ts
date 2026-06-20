import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	getNativeOAuthCallbackUri,
	getNativeOAuthLogoutCallbackUri,
	isLoopbackOrigin,
	NativeOAuthApplicationId,
	OAUTH_NATIVE_APPLICATION_IDS,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_LOGOUT_CALLBACK_URIS,
} from "./oauth";

describe("NativeOAuthApplicationId", () => {
	it("defines the exact native application IDs", () => {
		expect(OAUTH_NATIVE_APPLICATION_IDS).toEqual(["io.ryot.app", "io.ryot.app.dev"]);
	});

	it.each(OAUTH_NATIVE_APPLICATION_IDS)("accepts %s", (applicationId) => {
		expect(Schema.decodeUnknownSync(NativeOAuthApplicationId)(applicationId)).toBe(applicationId);
	});

	it("rejects an unknown application ID", () => {
		expect(() => Schema.decodeUnknownSync(NativeOAuthApplicationId)("io.ryot.app.test")).toThrow();
	});
});

describe("native OAuth callback URIs", () => {
	it("builds the exact callback URIs", () => {
		expect(getNativeOAuthCallbackUri("io.ryot.app")).toBe("io.ryot.app:/auth/callback");
		expect(getNativeOAuthCallbackUri("io.ryot.app.dev")).toBe("io.ryot.app.dev:/auth/callback");
		expect(getNativeOAuthLogoutCallbackUri("io.ryot.app")).toBe(
			"io.ryot.app:/auth/logout/callback",
		);
		expect(getNativeOAuthLogoutCallbackUri("io.ryot.app.dev")).toBe(
			"io.ryot.app.dev:/auth/logout/callback",
		);
		expect(OAUTH_NATIVE_CALLBACK_URIS).toEqual([
			"io.ryot.app:/auth/callback",
			"io.ryot.app.dev:/auth/callback",
		]);
		expect(OAUTH_NATIVE_LOGOUT_CALLBACK_URIS).toEqual([
			"io.ryot.app:/auth/logout/callback",
			"io.ryot.app.dev:/auth/logout/callback",
		]);
	});
});

describe("isLoopbackOrigin", () => {
	it.each([
		"http://localhost:3005",
		"http://127.0.0.1:3000",
		"http://127.5.5.5",
		"http://[::1]:8000",
		"http://tenant.localhost",
	])("treats %s as loopback", (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(true);
	});

	it.each([
		"http://192.168.1.50:8000",
		"http://10.0.0.4",
		"http://ryot.lan",
		"http://notlocalhost",
		"https://app.ryot.io",
	])("treats %s as routable", (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(false);
	});
});
