import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import { describe, expect, it } from "vitest";

import {
	getCustomizeSectionCounts,
	initCustomizeDraft,
	isCustomizeDraftDirty,
	moveCustomizeItem,
	toggleCustomizeItem,
} from "./customize-state";

const data = {
	collections: [],
	workspaces: [
		{ sortOrder: 0, slug: "media", name: "Media", isDisabled: false, icon: "clapperboard" },
	],
	savedViews: [
		{
			icon: "film",
			sortOrder: 4,
			slug: "view-four",
			isDisabled: false,
			name: "Fourth View",
			pluginSlug: "media",
		},
		{
			icon: "film",
			sortOrder: 1,
			isDisabled: true,
			pluginSlug: "media",
			name: "Disabled View",
			slug: "view-disabled",
		},
		{
			sortOrder: 3,
			icon: "film",
			isDisabled: false,
			name: "Third View",
			slug: "view-three",
			pluginSlug: "media",
		},
		{
			icon: "film",
			sortOrder: 2,
			slug: "view-two",
			isDisabled: false,
			name: "Second View",
			pluginSlug: "media",
		},
		{
			icon: "film",
			sortOrder: 0,
			isDisabled: false,
			slug: "view-other",
			pluginSlug: "fitness",
			name: "Other Workspace View",
		},
		{
			sortOrder: 1,
			icon: "bookmark",
			isDisabled: true,
			pluginSlug: null,
			slug: "saved-disabled",
			name: "Disabled Saved View",
		},
		{
			sortOrder: 0,
			icon: "bookmark",
			pluginSlug: null,
			isDisabled: false,
			name: "Saved View",
			slug: "saved-view",
		},
	],
} satisfies NavigationData;

const draft = initCustomizeDraft({ data, workspaceSlug: "media" });

describe("initCustomizeDraft", () => {
	it("partitions, sorts, and includes disabled items without Home", () => {
		expect(draft.views.map((item) => item.slug)).toEqual([
			"view-disabled",
			"view-two",
			"view-three",
			"view-four",
		]);
		expect(draft.savedViews.map((item) => item.slug)).toEqual(["saved-view", "saved-disabled"]);
		expect(draft.views.some((item) => item.name === "Home")).toBe(false);
		expect(draft.views.find((item) => item.slug === "view-disabled")?.isDisabled).toBe(true);
	});
});

describe("moveCustomizeItem", () => {
	it("reorders within one section and leaves the other section untouched", () => {
		const savedViews = draft.savedViews;
		const nextDraft = moveCustomizeItem({ draft, section: "views", fromIndex: 0, toIndex: 2 });

		expect(nextDraft.views.map((item) => item.slug)).toEqual([
			"view-two",
			"view-three",
			"view-disabled",
			"view-four",
		]);
		expect(nextDraft.savedViews).toBe(savedViews);
	});

	it("clamps out-of-range indices", () => {
		const nextDraft = moveCustomizeItem({
			draft,
			toIndex: 99,
			fromIndex: -1,
			section: "savedViews",
		});

		expect(nextDraft.savedViews.map((item) => item.slug)).toEqual(["saved-disabled", "saved-view"]);
	});

	it("does not change an empty section", () => {
		const emptyDraft = { ...draft, views: [] };

		expect(
			moveCustomizeItem({ draft: emptyDraft, section: "views", fromIndex: 0, toIndex: 1 }),
		).toBe(emptyDraft);
	});
});

describe("toggleCustomizeItem", () => {
	it("flips visibility without changing position", () => {
		const nextDraft = toggleCustomizeItem({ draft, section: "views", slug: "view-two" });

		expect(nextDraft.views.map((item) => item.slug)).toEqual(draft.views.map((item) => item.slug));
		expect(nextDraft.views.find((item) => item.slug === "view-two")?.isDisabled).toBe(true);
	});

	it("returns the draft unchanged for an unknown slug", () => {
		expect(toggleCustomizeItem({ draft, section: "savedViews", slug: "missing" })).toBe(draft);
	});
});

describe("isCustomizeDraftDirty", () => {
	it("detects order and visibility changes", () => {
		const reordered = moveCustomizeItem({ draft, section: "views", fromIndex: 0, toIndex: 1 });
		const toggled = toggleCustomizeItem({ draft, section: "savedViews", slug: "saved-view" });

		expect(isCustomizeDraftDirty({ draft: reordered, initial: draft })).toBe(true);
		expect(isCustomizeDraftDirty({ draft: toggled, initial: draft })).toBe(true);
	});

	it("returns false for identical drafts", () => {
		expect(isCustomizeDraftDirty({ draft, initial: draft })).toBe(false);
	});
});

describe("getCustomizeSectionCounts", () => {
	it("adds Home to both Views counts", () => {
		expect(getCustomizeSectionCounts({ draft, section: "views" })).toEqual({ shown: 4, total: 5 });
	});

	it("does not adjust Saved Views counts", () => {
		expect(getCustomizeSectionCounts({ draft, section: "savedViews" })).toEqual({
			shown: 1,
			total: 2,
		});
	});
});
