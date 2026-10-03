import { EntityId, PluginSlug } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	toGlobalHref,
	toNavigationRequest,
	toPluginLocation,
	validatePluginLocation,
} from "#/modules/plugins/plugin-location";

describe("plugin logical locations", () => {
	it("maps the real global route and search to a document location", () => {
		expect(toPluginLocation("fixture", "/fixture/details/1", "?tab=stats")).toEqual({
			kind: "route",
			path: "/details/1",
			search: "tab=stats",
		});
	});

	it("builds global hrefs from explicit targets", () => {
		expect(
			toGlobalHref({
				path: "/shows",
				search: "q=dune",
				kind: "plugin-route",
				pluginSlug: PluginSlug.make("media"),
			}),
		).toBe("/media/shows?q=dune");
		expect(toGlobalHref({ kind: "entity", entityId: EntityId.make("entity/1") })).toBe(
			"/e/entity%2F1",
		);
		expect(toGlobalHref({ slug: "view/1", kind: "saved-view" })).toBe("/v/view%2F1");
	});

	it("does not infer a plugin slug from the active caller", () => {
		expect(
			toNavigationRequest({
				mode: "replace",
				type: "navigate",
				target: {
					search: "",
					path: "/shows",
					kind: "plugin-route",
					pluginSlug: PluginSlug.make("media"),
				},
			}),
		).toEqual({ replace: true, href: "/media/shows" });
	});

	it("navigates a kernel page target to its kernel route", () => {
		expect(
			toNavigationRequest({
				mode: "push",
				type: "navigate",
				target: { kind: "kernel-page", page: "import-data" },
			}),
		).toEqual({ replace: false, href: "/settings/import-data" });
	});

	it("rejects route traversal and an empty entity ID", () => {
		expect(
			validatePluginLocation({ search: "", kind: "route", path: "/../settings" }),
		).toBeUndefined();
		expect(
			toNavigationRequest({
				mode: "push",
				type: "navigate",
				target: { kind: "entity", entityId: EntityId.make("") },
			}),
		).toBeUndefined();
	});
});
