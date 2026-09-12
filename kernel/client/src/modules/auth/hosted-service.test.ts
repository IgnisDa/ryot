import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	parseTotpEnrollment,
	requestDemoSignIn,
	requestInitializationStatus,
} from "#/modules/auth/hosted-service";

describe("hosted auth service demo sign-in", () => {
	it.live.each(["demo", "standard"] as const)("accepts the %s mode", (mode) =>
		Effect.gen(function* () {
			const requests: Array<{ init?: RequestInit; url: string }> = [];
			const request = requestDemoSignIn((input, init) => {
				let url: string;
				if (typeof input === "string") {
					url = input;
				} else if (input instanceof URL) {
					url = input.href;
				} else {
					url = input.url;
				}
				requests.push({ url, init });
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
	);

	it.live("rejects an unavailable response without exposing its payload", () =>
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
	);
});

describe("hosted auth initialization status", () => {
	it.live.each(["initializing", "ready"] as const)("accepts the %s status", (status) =>
		Effect.gen(function* () {
			const requests: Array<{ init?: RequestInit; url: string }> = [];
			const request = requestInitializationStatus((input, init) => {
				let url: string;
				if (typeof input === "string") {
					url = input;
				} else if (input instanceof URL) {
					url = input.href;
				} else {
					url = input.url;
				}
				requests.push({ url, init });
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
	);

	it.live("rejects an invalid initialization status", () =>
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
	);

	it.live("rejects an expired sign-in session", () =>
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
	);
});

describe("hosted auth TOTP enrollment", () => {
	it("extracts the setup key from a TOTP provisioning URI", () => {
		const totpURI = "otpauth://totp/Ryot:user%40ryot.example?secret=JBSWY3DPEHPK3PXP&issuer=Ryot";

		expect(parseTotpEnrollment(totpURI)).toEqual({ totpURI, secret: "JBSWY3DPEHPK3PXP" });
	});

	it.each([
		"javascript:alert(1)//?secret=JBSWY3DPEHPK3PXP",
		"https://ryot.example/?secret=JBSWY3DPEHPK3PXP",
		"otpauth://hotp/Ryot:user?secret=JBSWY3DPEHPK3PXP",
		"otpauth://totp/Ryot:user?issuer=Ryot",
		"not a uri",
	])("rejects %s", (totpURI) => {
		expect(parseTotpEnrollment(totpURI)).toBeNull();
	});
});
