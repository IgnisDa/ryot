import { describe, expect, it } from "vitest";

import { isSettingsPath, resolveEdgeIntent } from "#/modules/navigation/edge-intent";

describe("resolveEdgeIntent", () => {
	it("opens the drawer at a workspace root even when history can be popped", () => {
		expect(resolveEdgeIntent({ atRoot: true, pathname: "/media", canGoBack: true })).toBe("drawer");
	});

	it("goes back on a plugin child route", () => {
		expect(resolveEdgeIntent({ atRoot: false, pathname: "/media/search", canGoBack: true })).toBe(
			"back",
		);
	});

	it("goes back on a settings route, where no drawer is mounted", () => {
		expect(
			resolveEdgeIntent({ atRoot: false, pathname: "/settings/account", canGoBack: true }),
		).toBe("back");
	});

	it("falls through to the drawer when a child route has nothing to pop", () => {
		expect(resolveEdgeIntent({ atRoot: false, pathname: "/media/search", canGoBack: false })).toBe(
			"drawer",
		);
	});

	it("binds nothing on a settings route with no history", () => {
		expect(resolveEdgeIntent({ atRoot: false, pathname: "/settings", canGoBack: false })).toBe(
			"none",
		);
	});
});

describe("isSettingsPath", () => {
	it("matches the settings tree and nothing that merely starts with it", () => {
		expect(isSettingsPath("/settings")).toBe(true);
		expect(isSettingsPath("/settings/preferences")).toBe(true);
		expect(isSettingsPath("/settings-workspace")).toBe(false);
		expect(isSettingsPath("/media")).toBe(false);
	});
});
