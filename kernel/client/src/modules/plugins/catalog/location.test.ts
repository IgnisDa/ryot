import { EntityId, PluginId, PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import {
	toGlobalHref,
	toNavigationRequest,
	toPluginLocation,
	validatePluginLocation,
} from "#/modules/plugins/catalog/location";

const catalog: PluginClientCatalog = [
	{
		icon: "film",
		sortOrder: 0,
		name: "Owner",
		scope: "system",
		health: "ready",
		isHidden: false,
		clientApiVersion: 1,
		homeSavedView: null,
		clientEntities: null,
		contentHash: "source",
		installationId: "installation",
		pluginId: PluginId.make("owner"),
		packageId: PluginPackageId.make("test/owner"),
	},
];

describe("plugin logical locations", () => {
	it("maps the real global route and search to a document location", () => {
		expect(
			toPluginLocation(
				PluginPackageId.make("test/fixture"),
				"/p/test/fixture/details/1",
				"?tab=stats",
			),
		).toEqual({ kind: "route", path: "/details/1", search: "tab=stats" });
	});

	it("builds global hrefs from explicit targets", () => {
		expect(
			toGlobalHref(
				{
					path: "/shows",
					search: "q=dune",
					kind: "plugin-route",
					packageId: PluginPackageId.make("ryot/media"),
				},
				catalog,
			),
		).toBe("/p/ryot/media/shows?q=dune");
		expect(toGlobalHref({ kind: "entity", entityId: EntityId.make("entity/1") }, catalog)).toBe(
			"/e/entity%2F1",
		);
		expect(
			toGlobalHref(
				{
					kind: "saved-view",
					reference: { kind: "custom", savedViewId: SavedViewId.make("view/1") },
				},
				catalog,
			),
		).toBe("/v/c/view%2F1");
		expect(
			toGlobalHref({ kind: "saved-view", reference: { slug: "same", kind: "kernel" } }, catalog),
		).toBe("/v/k/same");
		expect(
			toGlobalHref(
				{
					kind: "saved-view",
					reference: { slug: "same", kind: "plugin", pluginId: PluginId.make("owner") },
				},
				catalog,
			),
		).toBe("/v/p/test/owner/same");
	});

	it("does not infer a plugin owner from the active caller", () => {
		expect(
			toNavigationRequest(
				{
					mode: "replace",
					type: "navigate",
					target: {
						search: "",
						path: "/shows",
						kind: "plugin-route",
						packageId: PluginPackageId.make("ryot/media"),
					},
				},
				catalog,
			),
		).toEqual({ replace: true, href: "/p/ryot/media/shows" });
	});

	it("navigates a kernel page target to its kernel route", () => {
		expect(
			toNavigationRequest(
				{ mode: "push", type: "navigate", target: { kind: "kernel-page", page: "import-data" } },
				catalog,
			),
		).toEqual({ replace: false, href: "/settings/import-data" });
	});

	it("rejects route traversal and an empty entity ID", () => {
		expect(
			validatePluginLocation({ search: "", kind: "route", path: "/../settings" }),
		).toBeUndefined();
		expect(
			toNavigationRequest(
				{ mode: "push", type: "navigate", target: { kind: "entity", entityId: EntityId.make("") } },
				catalog,
			),
		).toBeUndefined();
	});

	it("resolves plugin preferences against the current workspace installation", () => {
		const target = {
			kind: "plugin-preferences" as const,
			packageId: PluginPackageId.make("test/owner"),
		};
		expect(toNavigationRequest({ target, mode: "push", type: "navigate" }, catalog)).toEqual({
			replace: false,
			href: "/settings/plugin-preferences/installation",
		});
		expect(
			toNavigationRequest(
				{ target, mode: "replace", type: "navigate" },
				catalog.map((entry) => ({
					...entry,
					isHidden: true,
					installationId: "another/installation",
				})),
			),
		).toEqual({ replace: true, href: "/settings/plugin-preferences/another%2Finstallation" });
		expect(toNavigationRequest({ target, mode: "push", type: "navigate" }, [])).toBeUndefined();
		expect(toGlobalHref({ kind: "kernel-page", page: "plugin-preferences" }, catalog)).toBe(
			"/settings/plugin-preferences",
		);
	});
});
