import { EntityId, PluginId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	toGlobalHref,
	toNavigationRequest,
	toPluginLocation,
	validatePluginLocation,
} from "#/modules/plugins/plugin-location";

describe("plugin logical locations", () => {
	it("maps the real global route and search to a document location", () => {
		expect(toPluginLocation("fixture", "/p/fixture/details/1", "?tab=stats")).toEqual({
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
				pluginId: PluginId.make("media"),
			}),
		).toBe("/p/media/shows?q=dune");
		expect(toGlobalHref({ kind: "entity", entityId: EntityId.make("entity/1") })).toBe(
			"/e/entity%2F1",
		);
		expect(
			toGlobalHref({
				kind: "saved-view",
				reference: { kind: "custom", savedViewId: SavedViewId.make("view/1") },
			}),
		).toBe("/v/c/view%2F1");
		expect(toGlobalHref({ kind: "saved-view", reference: { slug: "same", kind: "kernel" } })).toBe(
			"/v/k/same",
		);
		expect(
			toGlobalHref({
				kind: "saved-view",
				reference: { slug: "same", kind: "plugin", pluginId: PluginId.make("owner") },
			}),
		).toBe("/v/p/owner/same");
	});

	it("does not infer a plugin owner from the active caller", () => {
		expect(
			toNavigationRequest({
				mode: "replace",
				type: "navigate",
				target: {
					search: "",
					path: "/shows",
					kind: "plugin-route",
					pluginId: PluginId.make("media"),
				},
			}),
		).toEqual({ replace: true, href: "/p/media/shows" });
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
