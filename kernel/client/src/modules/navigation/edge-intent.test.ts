import { describe, expect, it } from "vitest";

import { isSettingsPath, resolveEdge } from "#/modules/navigation/edge-intent";

const resolve = (input: Partial<Parameters<typeof resolveEdge>[0]> = {}) =>
	resolveEdge({
		atRoot: false,
		canGoBack: true,
		isDesktop: false,
		hasPluginDocument: true,
		pathname: "/media/search",
		...input,
	});

describe("resolveEdge", () => {
	it("opens the drawer at a workspace root even when history can be popped", () => {
		expect(resolve({ atRoot: true, pathname: "/media" })).toEqual({
			compact: true,
			owner: "kernel",
			intent: "drawer",
		});
	});

	it("gives the plugin document the back gesture on a plugin child route", () => {
		expect(resolve()).toEqual({ compact: true, owner: "plugin", intent: "back" });
	});

	it("keeps back in the kernel on a settings route, where no plugin document exists", () => {
		expect(resolve({ pathname: "/settings/account", hasPluginDocument: false })).toEqual({
			compact: true,
			intent: "back",
			owner: "kernel",
		});
	});

	it("keeps back in the kernel on desktop, where the edge gesture is not offered", () => {
		expect(resolve({ isDesktop: true })).toEqual({
			intent: "back",
			compact: false,
			owner: "kernel",
		});
	});

	it("reports a compact viewport even where the kernel keeps the edge", () => {
		expect(resolve({ atRoot: true, pathname: "/media" }).compact).toBe(true);
		expect(resolve({ isDesktop: true, atRoot: true, pathname: "/media" }).compact).toBe(false);
	});

	it("falls through to the drawer when a child route has nothing to pop", () => {
		expect(resolve({ canGoBack: false })).toEqual({
			compact: true,
			owner: "kernel",
			intent: "drawer",
		});
	});

	it("binds nothing on a settings route with no history", () => {
		expect(resolve({ pathname: "/settings", canGoBack: false, hasPluginDocument: false })).toEqual({
			compact: true,
			intent: "none",
			owner: "kernel",
		});
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
