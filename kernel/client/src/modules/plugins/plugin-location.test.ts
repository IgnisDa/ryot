import { describe, expect, it } from "vitest";

import {
	toGlobalHref,
	toNavigationRequest,
	toPluginLocation,
	validatePluginLocation,
} from "#/modules/plugins/plugin-location";

const home = { path: "/", search: "" };

describe("plugin logical locations", () => {
	it("strips the installed namespace from the global location", () => {
		expect(toPluginLocation("fixture", "/fixture", "")).toEqual(home);
		expect(toPluginLocation("fixture", "/fixture/", "")).toEqual(home);
		expect(toPluginLocation("fixture", "/fixture/details/item-1", "?tab=stats")).toEqual({
			search: "tab=stats",
			path: "/details/item-1",
		});
		expect(toPluginLocation("fixture", "/fixture/details/item-1/", "tab=stats")).toEqual({
			search: "tab=stats",
			path: "/details/item-1",
		});
	});

	it("restores the installed namespace when building a global href", () => {
		expect(toGlobalHref("fixture", home)).toBe("/fixture");
		expect(toGlobalHref("fixture", { path: "/", search: "tab=stats" })).toBe("/fixture?tab=stats");
		expect(toGlobalHref("fixture", { path: "/details/item-1", search: "tab=stats" })).toBe(
			"/fixture/details/item-1?tab=stats",
		);
	});

	it("round-trips a global location through the plugin location", () => {
		const location = toPluginLocation("fixture", "/fixture/details/item-1", "?tab=stats");

		expect(toGlobalHref("fixture", location)).toBe("/fixture/details/item-1?tab=stats");
	});

	it("accepts a relative plugin path and keeps it inside the namespace", () => {
		const settings = validatePluginLocation({ path: "/settings", search: "" });

		expect(settings).toEqual({ path: "/settings", search: "" });
		expect(toGlobalHref("fixture", settings ?? home)).toBe("/fixture/settings");
	});

	it("rejects traversal, absolute, and reserved-route escapes", () => {
		for (const path of [
			"/../settings",
			"/details/../../auth",
			"/./settings",
			"/%2e%2e/settings",
			"/%2E%2E/other-plugin",
			"/details/.%2e/%2e./auth",
			"/%2e/settings",
			"/%2E/settings",
			"..",
			"/..",
			"//evil.example/settings",
			"https://evil.example/settings",
			"settings",
			"",
			"/details\\..\\auth",
			"/details/1?tab=stats",
			"/details/1#top",
			"/details /1",
		]) {
			expect(validatePluginLocation({ path, search: "" })).toBeUndefined();
		}
	});

	it("rejects a search value that carries a fragment or whitespace", () => {
		expect(validatePluginLocation({ path: "/details/1", search: "tab=stats#top" })).toBeUndefined();
		expect(validatePluginLocation({ path: "/details/1", search: "tab=a b" })).toBeUndefined();
	});

	it("turns a plugin navigation request into a namespaced kernel navigation", () => {
		expect(
			toNavigationRequest("fixture", {
				mode: "push",
				type: "navigate",
				location: { path: "/details/item-1", search: "tab=stats" },
			}),
		).toEqual({ replace: false, href: "/fixture/details/item-1?tab=stats" });

		expect(
			toNavigationRequest("fixture", {
				mode: "replace",
				type: "navigate",
				location: { path: "/", search: "" },
			}),
		).toEqual({ replace: true, href: "/fixture" });
	});

	it("drops a navigation request that leaves the installation namespace", () => {
		for (const path of ["/../settings", "/%2e%2e/other-plugin", "/%2E%2E/auth"]) {
			expect(
				toNavigationRequest("fixture", {
					mode: "push",
					type: "navigate",
					location: { path, search: "" },
				}),
			).toBeUndefined();
		}
	});

	it("keeps a segment that only looks like a traversal", () => {
		for (const path of ["/details/...", "/details/%2e%2e%2e", "/details/%252e%252e"]) {
			expect(
				toNavigationRequest("fixture", {
					mode: "push",
					type: "navigate",
					location: { path, search: "" },
				}),
			).toEqual({ replace: false, href: `/fixture${path}` });
		}
	});
});
