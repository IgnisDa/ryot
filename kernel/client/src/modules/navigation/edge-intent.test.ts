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
		pathname: "/fixture/search",
		...input,
	});

describe("resolveEdge", () => {
	it.each([
		{
			input: {},
			name: "plugin child ready",
			expected: { compact: true, intent: "back", owner: "plugin" },
		},
		{
			input: { pathname: "/e/entity-1" },
			expected: { compact: true, intent: "back", owner: "plugin" },
			name: "plugin to entity in the same document with generic readiness",
		},
		{
			name: "saved view to entity without plugin readiness",
			expected: { compact: true, intent: "back", owner: "kernel" },
			input: { pathname: "/e/entity-1", hasPluginBackScreen: false },
		},
		{
			name: "cross-plugin navigation without readiness",
			expected: { compact: true, intent: "back", owner: "kernel" },
			input: { hasPluginBackScreen: false, pathname: "/other/records" },
		},
		{
			name: "direct entity entry with no history",
			expected: { compact: true, owner: "kernel", intent: "drawer" },
			input: { canGoBack: false, pathname: "/e/entity-1", hasPluginBackScreen: false },
		},
		{
			name: "workspace root",
			input: { atRoot: true, pathname: "/fixture" },
			expected: { compact: true, owner: "kernel", intent: "drawer" },
		},
		{
			input: { isDesktop: true },
			name: "desktop child with no interactive edge",
			expected: { compact: false, intent: "back", owner: "kernel" },
		},
		{
			input: { hasPluginBackScreen: false },
			name: "plugin child with a blocked artifact",
			expected: { compact: true, intent: "back", owner: "kernel" },
		},
		{
			name: "iframe overlay at the root in a compact viewport",
			expected: { compact: true, intent: "back", owner: "iframe-overlay" },
			input: { atRoot: true, canGoBack: false, pathname: "/fixture", hasIframeOverlay: true },
		},
		{
			name: "iframe overlay at the root on desktop",
			expected: { compact: false, intent: "back", owner: "iframe-overlay" },
			input: {
				atRoot: true,
				isDesktop: true,
				canGoBack: false,
				pathname: "/fixture",
				hasIframeOverlay: true,
			},
		},
	] as const)("resolves $name", ({ input, expected }) => {
		expect(resolve(input)).toEqual(expected);
	});

	it("reports a compact viewport even where the kernel keeps the edge", () => {
		expect(resolve({ atRoot: true, pathname: "/fixture" }).compact).toBe(true);
		expect(resolve({ atRoot: true, isDesktop: true, pathname: "/fixture" }).compact).toBe(false);
	});

	it("routes edge Back to an iframe overlay and restores ownership after it closes", () => {
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
		expect(resolve({ hasPluginBackScreen: false, pathname: "/customize-sidebar" })).toEqual({
			compact: true,
			intent: "back",
			owner: "kernel",
		});
	});

	it("offers no drawer on the customize route even with nothing to pop", () => {
		expect(
			resolve({ canGoBack: false, hasPluginBackScreen: false, pathname: "/customize-sidebar" }),
		).toEqual({ compact: true, intent: "none", owner: "kernel" });
	});

	it("binds nothing on a settings route with no history", () => {
		expect(
			resolve({ canGoBack: false, pathname: "/settings", hasPluginBackScreen: false }),
		).toEqual({ compact: true, intent: "none", owner: "kernel" });
	});
});

describe("isSettingsPath", () => {
	it("matches the settings tree and nothing that merely starts with it", () => {
		expect(isSettingsPath("/settings")).toBe(true);
		expect(isSettingsPath("/settings/preferences")).toBe(true);
		expect(isSettingsPath("/settings-workspace")).toBe(false);
		expect(isSettingsPath("/fixture")).toBe(false);
	});
});

describe("isCustomizeSidebarPath", () => {
	it("matches the customize route and nothing that merely starts with it", () => {
		expect(isCustomizeSidebarPath("/customize-sidebar")).toBe(true);
		expect(isCustomizeSidebarPath("/customize-sidebar/views")).toBe(true);
		expect(isCustomizeSidebarPath("/customize-sidebars")).toBe(false);
		expect(isCustomizeSidebarPath("/fixture")).toBe(false);
	});
});

describe("hasWorkspaceChrome", () => {
	it("withholds the workspace chrome from every route that owns its own back control", () => {
		expect(hasWorkspaceChrome("/fixture")).toBe(true);
		expect(hasWorkspaceChrome("/v/all-items")).toBe(true);
		expect(hasWorkspaceChrome("/settings/account")).toBe(false);
		expect(hasWorkspaceChrome("/customize-sidebar")).toBe(false);
	});
});
