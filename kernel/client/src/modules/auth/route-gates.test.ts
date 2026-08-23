import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { decideAuthRoute, decideProtectedRoute } from "#/modules/auth/route-gates";

const origin = decodeServerOrigin("https://one.test");
const equivalentOrigin = decodeServerOrigin(" https://one.test/ ");

describe("authentication route gates", () => {
	it("waits while a session is being restored", () => {
		expect(decideAuthRoute(origin, { status: "pending" }, "/library")).toEqual({ action: "wait" });
		expect(decideProtectedRoute(origin, { status: "pending" }, "/library")).toEqual({
			action: "wait",
		});
	});

	it("sends a missing protected session to auth with a safe destination", () => {
		expect(decideProtectedRoute(origin, { status: "missing" }, "/library?tab=recent")).toEqual({
			to: "/auth",
			action: "redirect",
			redirectTo: "/library?tab=recent",
		});
		expect(decideProtectedRoute(origin, { status: "missing" }, "https://evil.test")).toEqual({
			to: "/auth",
			action: "redirect",
			redirectTo: undefined,
		});
	});

	it("allows a restored session with a canonical scope", () => {
		expect(
			decideProtectedRoute(
				equivalentOrigin,
				{ userId: "user-1", status: "authenticated" },
				"/library",
			),
		).toEqual({ action: "allow", scope: { userId: "user-1", serverUrl: "https://one.test" } });
	});

	it("returns an authenticated auth visit to a safe destination or root", () => {
		expect(
			decideAuthRoute(origin, { userId: "user-1", status: "authenticated" }, "/library"),
		).toEqual({ to: "/library", action: "redirect" });
		expect(
			decideAuthRoute(origin, { userId: "user-1", status: "authenticated" }, "//evil.test"),
		).toEqual({ to: "/", action: "redirect" });
	});

	it("sends any visit without a server to onboarding", () => {
		expect(decideAuthRoute(null, { status: "missing" }, "/library")).toEqual({
			to: "/onboarding",
			action: "redirect",
			redirectTo: "/library",
		});
		expect(
			decideProtectedRoute(null, { userId: "user-1", status: "authenticated" }, "/library"),
		).toEqual({ to: "/onboarding", action: "redirect", redirectTo: "/library" });
	});
});
