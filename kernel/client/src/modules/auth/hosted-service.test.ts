import { describe, expect, test } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import {
	parseTotpEnrollment,
	requestConsentDetails,
	requestDemoSignIn,
	requestImpersonationRedeem,
	requestInitializationStatus,
} from "#/modules/auth/hosted-service";

const requestUrl = (input: Parameters<typeof fetch>[0]) => {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
};

describe("hosted auth service demo sign-in", () => {
	it.live.each(["demo", "standard"] as const)(
		"accepts the %s mode",
		(mode) =>
			Effect.gen(function* () {
				const requests: Array<{ url: string; init?: RequestInit }> = [];
				const request = requestDemoSignIn((input, init) => {
					requests.push({ init, url: requestUrl(input) });
					return Promise.resolve(Response.json({ mode }));
				}, "https://ryot.example");

				expect(yield* request).toEqual({ mode });
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe("https://ryot.example/api/auth/demo/sign-in");
				expect(requests[0]?.init).toMatchObject({
					body: "{}",
					method: "POST",
					cache: "no-store",
					credentials: "same-origin",
				});
			}),
		testTimeout,
	);

	it.live.each([{ mode: "unknown" }, { extra: true, mode: "demo" }, null])(
		"rejects an invalid response: %j",
		(payload) =>
			Effect.gen(function* () {
				const request = requestDemoSignIn(
					() => Promise.resolve(Response.json(payload)),
					"https://ryot.example",
				);

				expect(yield* Effect.flip(request)).toMatchObject({ _tag: "HostedAuthError" });
			}),
		testTimeout,
	);

	it.live(
		"rejects an unavailable response without exposing its payload",
		() =>
			Effect.gen(function* () {
				const request = requestDemoSignIn(
					() => Promise.resolve(Response.json({ email: "demo@ryot.example" }, { status: 403 })),
					"https://ryot.example",
				);

				expect(yield* Effect.flip(request)).toMatchObject({
					_tag: "HostedAuthError",
					message: "Could not open the shared demo.",
				});
			}),
		testTimeout,
	);
});

describe("hosted auth initialization status", () => {
	it.live.each(["initializing", "ready"] as const)(
		"accepts the %s status",
		(status) =>
			Effect.gen(function* () {
				const requests: Array<{ url: string; init?: RequestInit }> = [];
				const request = requestInitializationStatus((input, init) => {
					requests.push({ init, url: requestUrl(input) });
					return Promise.resolve(Response.json({ status }));
				}, "https://ryot.example");

				expect(yield* request).toEqual({ status });
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe("https://ryot.example/api/auth/initialization-status");
				expect(requests[0]?.init).toMatchObject({
					method: "GET",
					cache: "no-store",
					credentials: "same-origin",
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects an invalid initialization status",
		() =>
			Effect.gen(function* () {
				const request = requestInitializationStatus(
					() => Promise.resolve(Response.json({ status: "unknown" })),
					"https://ryot.example",
				);

				expect(yield* Effect.flip(request)).toMatchObject({
					_tag: "HostedAuthError",
					message: "The server returned an invalid account status.",
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects an expired sign-in session",
		() =>
			Effect.gen(function* () {
				const request = requestInitializationStatus(
					() => Promise.resolve(Response.json({}, { status: 401 })),
					"https://ryot.example",
				);

				expect(yield* Effect.flip(request)).toMatchObject({
					_tag: "HostedAuthError",
					message: "Your sign-in session has ended. Please sign in again.",
				});
			}),
		testTimeout,
	);
});

describe("hosted impersonation redemption", () => {
	it.live(
		"redeems the one-use ticket with same-origin credentials",
		() =>
			Effect.gen(function* () {
				const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
				let body: Promise<unknown> = Promise.resolve(undefined);
				const result = yield* requestImpersonationRedeem(
					(input, init) => {
						body = new Request(input, init).json();
						requests.push({ init, url: requestUrl(input) });
						return Promise.resolve(
							Response.json({ authorizationUrl: "https://identity.example/authorize" }),
						);
					},
					"https://ryot.example",
					"one-use-ticket",
				);

				expect(result).toEqual({ authorizationUrl: "https://identity.example/authorize" });
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe("https://ryot.example/api/auth/impersonation/redeem");
				expect(requests[0]?.init).toMatchObject({
					method: "POST",
					cache: "no-store",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
				});
				expect(yield* Effect.promise(() => body)).toEqual({ ticket: "one-use-ticket" });
			}),
		testTimeout,
	);

	it.live.each([
		{},
		{ authorizationUrl: 4 },
		{ extra: true, authorizationUrl: "https://idp.example/" },
	])(
		"rejects an invalid redemption response: %j",
		(payload) =>
			Effect.gen(function* () {
				const failure = yield* Effect.flip(
					requestImpersonationRedeem(
						() => Promise.resolve(Response.json(payload)),
						"https://ryot.example",
						"ticket",
					),
				);
				expect(failure.message).toBe("The server returned an invalid impersonation response.");
			}),
		testTimeout,
	);
});

describe("hosted auth TOTP enrollment", () => {
	it("extracts the setup key from a TOTP provisioning URI", () => {
		const totpURI = "otpauth://totp/Ryot:user%40ryot.example?secret=JBSWY3DPEHPK3PXP&issuer=Ryot";

		expect(parseTotpEnrollment(totpURI)).toEqual({ totpURI, secret: "JBSWY3DPEHPK3PXP" });
	});

	test.each([
		"javascript:alert(1)//?secret=JBSWY3DPEHPK3PXP",
		"https://ryot.example/?secret=JBSWY3DPEHPK3PXP",
		"otpauth://hotp/Ryot:user?secret=JBSWY3DPEHPK3PXP",
		"otpauth://totp/Ryot:user?issuer=Ryot",
		"not a uri",
	])("rejects %s", (totpURI) => {
		expect(parseTotpEnrollment(totpURI)).toBeNull();
	});
});

describe("hosted consent details", () => {
	it.live(
		"sends the signed query to the same-origin verification endpoint",
		() =>
			Effect.gen(function* () {
				const requests: Array<{ url: string; init?: RequestInit }> = [];
				const details = {
					scopes: ["ryot:read"],
					clientName: "Registered app",
					redirectOrigin: "https://client.example",
				} as const;
				const result = yield* requestConsentDetails(
					(input, init) => {
						requests.push({ init, url: requestUrl(input) });
						return Promise.resolve(Response.json(details));
					},
					"https://ryot.example",
					"client_id=client&sig=signature",
				);
				expect(result).toEqual(details);
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe("https://ryot.example/api/auth/oauth2/consent-details");
				expect(requests[0]?.init?.method).toBe("POST");
				expect(requests[0]?.init?.credentials).toBe("same-origin");
				expect(requests[0]?.init?.cache).toBe("no-store");
				expect(requests[0]?.init?.body).toBe('{"oauth_query":"client_id=client&sig=signature"}');
				expect(requests[0]?.init?.headers).toEqual({ "content-type": "application/json" });
			}),
		testTimeout,
	);

	it.live.each([
		{ status: 400, code: undefined },
		{ status: 401, code: "UNAUTHORIZED" },
		{ status: 500, code: undefined },
	])(
		"distinguishes session expiry from invalid or unavailable requests ($status)",
		({ code, status }) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					requestConsentDetails(
						() => Promise.resolve(Response.json({}, { status })),
						"https://ryot.example",
						"query",
					),
				);
				expect(error.code).toBe(code);
			}),
		testTimeout,
	);

	it.live.each([
		{ clientName: "App", scopes: ["unknown"], redirectOrigin: "https://client.example" },
		{ clientName: "App", scopes: ["ryot:read"] },
		{ clientName: 1, scopes: ["ryot:read"], redirectOrigin: "https://client.example" },
	])(
		"rejects invalid consent details: %j",
		(payload) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					requestConsentDetails(
						() => Promise.resolve(Response.json(payload)),
						"https://ryot.example",
						"query",
					),
				);
				expect(error.message).toBe("The server returned an invalid access request.");
			}),
		testTimeout,
	);
});
