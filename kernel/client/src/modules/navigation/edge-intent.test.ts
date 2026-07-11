import { describe, expect, it } from "vitest";

import {
	hasWorkspaceChrome,
	isCustomizeSidebarPath,
	isSettingsPath,
	resolveEdge,
} from "#/modules/navigation/edge-intent";

const resolve = (input: Partial<Parameters<typeof resolveEdge>[0]> = {}) =>
	resolveEdge({
		atRoot: false,
		canGoBack: true,
		isDesktop: false,
		hasIframeOverlay: false,
		hasPluginBackScreen: true,
		pathname: "/media/search",
		...input,
	});

describe("resolveEdge", () => {
	it.each([
		{
			input: {},
			name: "plugin child ready",
			expected: { compact: true, owner: "plugin", intent: "back" },
		},
		{
			input: { pathname: "/e/entity-1" },
			expected: { compact: true, owner: "plugin", intent: "back" },
			name: "plugin to entity in the same document with generic readiness",
		},
		{
			name: "saved view to entity without plugin readiness",
			expected: { compact: true, owner: "kernel", intent: "back" },
			input: { pathname: "/e/entity-1", hasPluginBackScreen: false },
		},
		{
			name: "cross-plugin navigation without readiness",
			expected: { compact: true, owner: "kernel", intent: "back" },
			input: { pathname: "/fitness/workouts", hasPluginBackScreen: false },
		},
		{
			name: "direct entity entry with no history",
			expected: { compact: true, owner: "kernel", intent: "drawer" },
			input: { pathname: "/e/entity-1", canGoBack: false, hasPluginBackScreen: false },
		},
		{
			name: "workspace root",
			input: { atRoot: true, pathname: "/media" },
			expected: { compact: true, owner: "kernel", intent: "drawer" },
		},
		{
			input: { isDesktop: true },
			name: "desktop child with no interactive edge",
			expected: { compact: false, owner: "kernel", intent: "back" },
		},
		{
			input: { hasPluginBackScreen: false },
			name: "plugin child with a blocked artifact",
			expected: { compact: true, owner: "kernel", intent: "back" },
		},
	] as const)("resolves $name", ({ expected, input }) => {
		expect(resolve(input)).toEqual(expected);
	});

	it("reports a compact viewport even where the kernel keeps the edge", () => {
		expect(resolve({ atRoot: true, pathname: "/media" }).compact).toBe(true);
		expect(resolve({ isDesktop: true, atRoot: true, pathname: "/media" }).compact).toBe(false);
	});

	it("suspends edge Back while an iframe overlay owns Back and resumes afterward", () => {
		expect(resolve({ hasIframeOverlay: true })).toEqual({
			compact: true,
			intent: "back",
			owner: "iframe-overlay",
		});
		expect(resolve({ hasIframeOverlay: false })).toEqual({
			compact: true,
			intent: "back",
			owner: "plugin",
		});
	});

	it("keeps back in the kernel on the customize route, which owns its own back control", () => {
		expect(resolve({ pathname: "/customize-sidebar", hasPluginBackScreen: false })).toEqual({
			compact: true,
			intent: "back",
			owner: "kernel",
		});
	});

	it("offers no drawer on the customize route even with nothing to pop", () => {
		expect(
			resolve({ pathname: "/customize-sidebar", canGoBack: false, hasPluginBackScreen: false }),
		).toEqual({ compact: true, intent: "none", owner: "kernel" });
	});

	it("binds nothing on a settings route with no history", () => {
		expect(
			resolve({ pathname: "/settings", canGoBack: false, hasPluginBackScreen: false }),
		).toEqual({ compact: true, intent: "none", owner: "kernel" });
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

describe("isCustomizeSidebarPath", () => {
	it("matches the customize route and nothing that merely starts with it", () => {
		expect(isCustomizeSidebarPath("/customize-sidebar")).toBe(true);
		expect(isCustomizeSidebarPath("/customize-sidebar/views")).toBe(true);
		expect(isCustomizeSidebarPath("/customize-sidebars")).toBe(false);
		expect(isCustomizeSidebarPath("/media")).toBe(false);
	});
});

describe("hasWorkspaceChrome", () => {
	it("withholds the workspace chrome from every route that owns its own back control", () => {
		expect(hasWorkspaceChrome("/media")).toBe(true);
		expect(hasWorkspaceChrome("/v/all-shows")).toBe(true);
		expect(hasWorkspaceChrome("/settings/account")).toBe(false);
		expect(hasWorkspaceChrome("/customize-sidebar")).toBe(false);
	});
});
