import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { describe, expect, it } from "vitest";

import {
	customizeSearchSection,
	customizeSectionCounts,
	initCustomizeDraft,
	isCustomizeDraftDirty,
	moveCustomizeItem,
	toggleCustomizeItem,
	type CustomizeDraft,
} from "#/modules/navigation/customize/customize-state";

const view = (slug: string, pluginSlug: string | null, sortOrder: number, isDisabled = false) => ({
	slug,
	sortOrder,
	isDisabled,
	pluginSlug,
	icon: "list",
	name: slug.toUpperCase(),
});

const workspace = (
	slug: string,
	sortOrder: number,
	isDisabled = false,
): PluginClientCatalogEntry => ({
	slug,
	sortOrder,
	isDisabled,
	icon: "plugin",
	health: "ready",
	clientApiVersion: 1,
	homeSavedViewId: null,
	name: slug.toUpperCase(),
	pluginId: `plugin-${slug}`,
	sourceHash: `source-${slug}`,
	installationId: `installation-${slug}`,
});

const catalog: PluginClientCatalog = [
	workspace("media", 2),
	workspace("disabled", 0, true),
	workspace("fitness", 1),
];

const data: NavigationData = {
	collections: [],
	savedViews: [
		view("shows", "media", 2),
		view("movies", "media", 1, true),
		view("all", null, 1),
		view("recent", null, 0),
	],
};

const draft = initCustomizeDraft({ data, catalog, workspaceSlug: "media" });

describe("initCustomizeDraft", () => {
	it("initializes all workspaces in catalog order, including disabled ones", () => {
		expect(draft.workspaces.map((item) => item.slug)).toEqual(["disabled", "fitness", "media"]);
		expect(draft.workspaces.map((item) => item.isDisabled)).toEqual([true, false, false]);
		expect(draft.workspaces[0]).toEqual({
			icon: "plugin",
			slug: "disabled",
			name: "DISABLED",
			isDisabled: true,
		});
		expect(draft.views[0]?.pluginSlug).toBe("media");
	});

	it("splits workspace views from global saved views and sorts each by sort order", () => {
		expect(draft.views.map((item) => item.slug)).toEqual(["movies", "shows"]);
		expect(draft.savedViews.map((item) => item.slug)).toEqual(["recent", "all"]);
	});

	it("keeps disabled items so they can be switched back on", () => {
		expect(draft.views.map((item) => item.isDisabled)).toEqual([true, false]);
	});

	it("leaves the views section empty when no workspace is selected", () => {
		expect(initCustomizeDraft({ data, catalog, workspaceSlug: undefined }).views).toEqual([]);
	});
});

describe("moveCustomizeItem", () => {
	it("moves an item within its own section", () => {
		const moved = moveCustomizeItem({ draft, toIndex: 1, fromIndex: 0, section: "views" });

		expect(moved.views.map((item) => item.slug)).toEqual(["shows", "movies"]);
		expect(moved.savedViews).toBe(draft.savedViews);
	});

	it("clamps an out-of-range target into the section", () => {
		const moved = moveCustomizeItem({ draft, toIndex: 9, fromIndex: 0, section: "views" });

		expect(moved.views.map((item) => item.slug)).toEqual(["shows", "movies"]);
	});

	it("moves an item within the workspaces section", () => {
		const moved = moveCustomizeItem({ draft, toIndex: 2, fromIndex: 0, section: "workspaces" });

		expect(moved.workspaces.map((item) => item.slug)).toEqual(["fitness", "media", "disabled"]);
	});

	it("returns the same draft for a move that changes nothing", () => {
		expect(moveCustomizeItem({ draft, toIndex: 1, fromIndex: 1, section: "views" })).toBe(draft);
	});
});

describe("toggleCustomizeItem", () => {
	it("flips visibility without moving the item", () => {
		const toggled = toggleCustomizeItem({ draft, slug: "shows", section: "views" });

		expect(toggled.views.map((item) => item.slug)).toEqual(["movies", "shows"]);
		expect(toggled.views.map((item) => item.isDisabled)).toEqual([true, true]);
	});

	it("ignores a slug that is not in the section", () => {
		expect(toggleCustomizeItem({ draft, slug: "all", section: "views" })).toBe(draft);
	});

	it("refuses to disable the final enabled workspace", () => {
		const onlyEnabled = {
			...draft,
			workspaces: draft.workspaces.map((item) =>
				item.slug === "fitness" ? item : { ...item, isDisabled: true },
			),
		};

		expect(
			toggleCustomizeItem({ slug: "fitness", draft: onlyEnabled, section: "workspaces" }),
		).toBe(onlyEnabled);
	});

	it("allows a disabled workspace to be enabled", () => {
		const toggled = toggleCustomizeItem({ draft, slug: "disabled", section: "workspaces" });

		expect(toggled.workspaces[0]?.isDisabled).toBe(false);
	});

	it("leaves the draft it was given untouched", () => {
		toggleCustomizeItem({ draft, slug: "shows", section: "views" });

		expect(draft.views.map((item) => item.isDisabled)).toEqual([true, false]);
	});
});

describe("isCustomizeDraftDirty", () => {
	it("reports an order change", () => {
		const moved = moveCustomizeItem({ draft, toIndex: 1, fromIndex: 0, section: "views" });

		expect(isCustomizeDraftDirty({ draft: moved, initial: draft })).toBe(true);
	});

	it("reports a visibility change", () => {
		const toggled = toggleCustomizeItem({ draft, slug: "all", section: "savedViews" });

		expect(isCustomizeDraftDirty({ draft: toggled, initial: draft })).toBe(true);
	});

	it("reports a workspace change", () => {
		const moved = moveCustomizeItem({ draft, toIndex: 1, fromIndex: 0, section: "workspaces" });

		expect(isCustomizeDraftDirty({ draft: moved, initial: draft })).toBe(true);
	});

	it("reports an untouched draft as clean", () => {
		expect(isCustomizeDraftDirty({ draft, initial: draft })).toBe(false);
	});
});

describe("customizeSectionCounts", () => {
	it("does not pin an item in the workspaces section", () => {
		expect(customizeSectionCounts({ draft, section: "workspaces" })).toEqual({
			shown: 2,
			total: 3,
		});
	});

	it("counts the pinned Home row in the views section", () => {
		expect(customizeSectionCounts({ draft, section: "views" })).toEqual({ shown: 2, total: 3 });
	});

	it("counts only the saved views in the saved views section", () => {
		expect(customizeSectionCounts({ draft, section: "savedViews" })).toEqual({
			shown: 2,
			total: 2,
		});
	});

	it("counts an empty section as Home alone", () => {
		const empty: CustomizeDraft = { views: [], workspaces: [], savedViews: [] };

		expect(customizeSectionCounts({ draft: empty, section: "views" })).toEqual({
			shown: 1,
			total: 1,
		});
	});
});

describe("customizeSearchSection", () => {
	it("accepts all section names", () => {
		expect(customizeSearchSection({ section: "workspaces" })).toBe("workspaces");
		expect(customizeSearchSection({ section: "views" })).toBe("views");
		expect(customizeSearchSection({ section: "savedViews" })).toBe("savedViews");
		expect(customizeSearchSection({ section: "collections" })).toBeUndefined();
		expect(customizeSearchSection({})).toBeUndefined();
	});
});
