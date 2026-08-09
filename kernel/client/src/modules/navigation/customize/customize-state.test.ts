import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
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

// A recipe row carries more branded structure than a fixture needs, so the fixture is widened once
// here rather than at every call site.
const data = {
	collections: [],
	savedViews: [
		view("shows", "media", 2),
		view("movies", "media", 1, true),
		view("all", null, 1),
		view("recent", null, 0),
	],
} as unknown as NavigationData;

const draft = initCustomizeDraft({ data, workspaceSlug: "media" });

describe("initCustomizeDraft", () => {
	it("splits workspace views from global saved views and sorts each by sort order", () => {
		expect(draft.views.map((item) => item.slug)).toEqual(["movies", "shows"]);
		expect(draft.savedViews.map((item) => item.slug)).toEqual(["recent", "all"]);
	});

	it("keeps disabled items so they can be switched back on", () => {
		expect(draft.views.map((item) => item.isDisabled)).toEqual([true, false]);
	});

	it("leaves the views section empty when no workspace is selected", () => {
		expect(initCustomizeDraft({ data, workspaceSlug: undefined }).views).toEqual([]);
	});
});

describe("moveCustomizeItem", () => {
	it("moves an item within its own section", () => {
		const moved = moveCustomizeItem({ draft, section: "views", fromIndex: 0, toIndex: 1 });

		expect(moved.views.map((item) => item.slug)).toEqual(["shows", "movies"]);
		expect(moved.savedViews).toBe(draft.savedViews);
	});

	it("clamps an out-of-range target into the section", () => {
		const moved = moveCustomizeItem({ draft, section: "views", fromIndex: 0, toIndex: 9 });

		expect(moved.views.map((item) => item.slug)).toEqual(["shows", "movies"]);
	});

	it("returns the same draft for a move that changes nothing", () => {
		expect(moveCustomizeItem({ draft, section: "views", fromIndex: 1, toIndex: 1 })).toBe(draft);
	});
});

describe("toggleCustomizeItem", () => {
	it("flips visibility without moving the item", () => {
		const toggled = toggleCustomizeItem({ draft, section: "views", slug: "shows" });

		expect(toggled.views.map((item) => item.slug)).toEqual(["movies", "shows"]);
		expect(toggled.views.map((item) => item.isDisabled)).toEqual([true, true]);
	});

	it("ignores a slug that is not in the section", () => {
		expect(toggleCustomizeItem({ draft, section: "views", slug: "all" })).toBe(draft);
	});

	it("leaves the draft it was given untouched", () => {
		toggleCustomizeItem({ draft, section: "views", slug: "shows" });

		expect(draft.views.map((item) => item.isDisabled)).toEqual([true, false]);
	});
});

describe("isCustomizeDraftDirty", () => {
	it("reports an order change", () => {
		const moved = moveCustomizeItem({ draft, section: "views", fromIndex: 0, toIndex: 1 });

		expect(isCustomizeDraftDirty({ draft: moved, initial: draft })).toBe(true);
	});

	it("reports a visibility change", () => {
		const toggled = toggleCustomizeItem({ draft, section: "savedViews", slug: "all" });

		expect(isCustomizeDraftDirty({ draft: toggled, initial: draft })).toBe(true);
	});

	it("reports an untouched draft as clean", () => {
		expect(isCustomizeDraftDirty({ draft, initial: draft })).toBe(false);
	});
});

describe("customizeSectionCounts", () => {
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
		const empty: CustomizeDraft = { views: [], savedViews: [] };

		expect(customizeSectionCounts({ draft: empty, section: "views" })).toEqual({
			shown: 1,
			total: 1,
		});
	});
});

describe("customizeSearchSection", () => {
	it("accepts only the two section names", () => {
		expect(customizeSearchSection({ section: "views" })).toBe("views");
		expect(customizeSearchSection({ section: "savedViews" })).toBe("savedViews");
		expect(customizeSearchSection({ section: "collections" })).toBeUndefined();
		expect(customizeSearchSection({})).toBeUndefined();
	});
});
