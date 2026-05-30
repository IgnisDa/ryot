import { describe, expect, it } from "vitest";

import { decideAuthRoute, decideProtectedRoute } from "#/modules/auth/route-gates";

describe("authentication route gates", () => {
	it("waits while a session is being restored", () => {
		expect(decideAuthRoute("https://one.test", { status: "pending" }, "/library")).toEqual({
			action: "wait",
		});
		expect(decideProtectedRoute("https://one.test", { status: "pending" }, "/library")).toEqual({
			action: "wait",
		});
	});

	it("sends a missing protected session to auth with a safe destination", () => {
		expect(
			decideProtectedRoute("https://one.test", { status: "missing" }, "/library?tab=recent"),
		).toEqual({
			to: "/auth",
			action: "redirect",
			redirectTo: "/library?tab=recent",
		});
		expect(
			decideProtectedRoute("https://one.test", { status: "missing" }, "https://evil.test"),
		).toEqual({ to: "/auth", action: "redirect", redirectTo: undefined });
	});

	it("allows a restored session with a canonical scope", () => {
		expect(
			decideProtectedRoute(
				" https://one.test/// ",
				{ status: "authenticated", userId: "user-1" },
				"/library",
			),
		).toEqual({ action: "allow", scope: { serverUrl: "https://one.test", userId: "user-1" } });
	});

	it("returns an authenticated auth visit to a safe destination or root", () => {
		expect(
			decideAuthRoute(
				"https://one.test",
				{ status: "authenticated", userId: "user-1" },
				"/library",
			),
		).toEqual({ action: "redirect", to: "/library" });
		expect(
			decideAuthRoute(
				"https://one.test",
				{ status: "authenticated", userId: "user-1" },
				"//evil.test",
			),
		).toEqual({ action: "redirect", to: "/" });
	});

	it("sends any visit without a server to onboarding", () => {
		expect(decideAuthRoute(null, { status: "missing" }, "/library")).toEqual({
			to: "/onboarding",
			action: "redirect",
			redirectTo: "/library",
		});
		expect(
			decideProtectedRoute(null, { status: "authenticated", userId: "user-1" }, "/library"),
		).toEqual({ to: "/onboarding", action: "redirect", redirectTo: "/library" });
	});
});
