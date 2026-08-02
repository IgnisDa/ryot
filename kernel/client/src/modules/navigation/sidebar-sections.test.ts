import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";
import { describe, expect, it } from "vitest";

import {
	activeSidebarKey,
	sidebarItemKey,
	sidebarSections,
	workspacePickerSummary,
	workspaceSummary,
} from "#/modules/navigation/sidebar-sections";

const view = (overrides: Partial<NavigationView> = {}): NavigationView => ({
	name: "View",
	slug: "view",
	icon: "list",
	sortOrder: 0,
	pluginSlug: null,
	isDisabled: false,
	...overrides,
});

type NavigationCollection = NavigationData["collections"][number];

const collection = (overrides: Partial<NavigationCollection> = {}): NavigationCollection => ({
	sortOrder: 0,
	icon: "layers-3",
	pluginSlug: null,
	isDisabled: false,
	name: "Collection",
	slug: "collection",
	...overrides,
});

describe("sidebar sections", () => {
	it("filters disabled rows, sorts items, and scopes workspace and global views", () => {
		const data: NavigationData = {
			collections: [
				collection({ sortOrder: 2, slug: "second", name: "Second Collection" }),
				collection({ sortOrder: 1, name: "First Collection", slug: "first-collection" }),
				collection({ isDisabled: true, name: "Hidden Collection", slug: "hidden-collection" }),
			],
			savedViews: [
				view({ sortOrder: 4, name: "Later", slug: "later", pluginSlug: "media" }),
				view({ sortOrder: 2, name: "Global", slug: "global" }),
				view({ name: "First", slug: "first", sortOrder: -1, pluginSlug: "media" }),
				view({ name: "Other", slug: "other", pluginSlug: "fitness" }),
				view({ name: "Hidden", slug: "hidden", isDisabled: true, pluginSlug: "media" }),
			],
		};

		const sections = sidebarSections({ data, workspaceSlug: "media" });

		expect(sections.views.map((item) => [item.name, item.kind])).toEqual([
			["Home", "home"],
			["First", "view"],
			["Later", "view"],
		]);
		expect(sections.savedViews.map((item) => item.name)).toEqual(["Global"]);
		expect(sections.collections.map((item) => item.name)).toEqual([
			"First Collection",
			"Second Collection",
		]);
		expect(workspaceSummary(sections)).toBe("3 views");
	});

	it("pluralizes a Home-only workspace summary", () => {
		const sections = sidebarSections({
			workspaceSlug: undefined,
			data: { savedViews: [], collections: [] },
		});

		expect(sections.views.map(sidebarItemKey)).toEqual(["home"]);
		expect(workspaceSummary(sections)).toBe("1 view");
	});

	it("formats a workspace picker summary from enabled views in sort order", () => {
		const data: NavigationData = {
			collections: [],
			savedViews: [
				view({ sortOrder: 4, name: "Fourth", slug: "fourth", pluginSlug: "media" }),
				view({
					sortOrder: 0,
					name: "Disabled",
					slug: "disabled",
					isDisabled: true,
					pluginSlug: "media",
				}),
				view({ sortOrder: 2, name: "Second", slug: "second", pluginSlug: "media" }),
				view({ sortOrder: 1, name: "Other", slug: "other", pluginSlug: "fitness" }),
				view({ sortOrder: 1, name: "First", slug: "first", pluginSlug: "media" }),
			],
		};

		expect(workspacePickerSummary(data, "media")).toBe("First, Second, Fourth");
		expect(workspacePickerSummary(data, "fitness")).toBe("Other");
	});

	it("adds the remaining count and handles empty workspaces", () => {
		const data: NavigationData = {
			collections: [],
			savedViews: [
				view({ sortOrder: 0, name: "First", slug: "first", pluginSlug: "media" }),
				view({ sortOrder: 1, name: "Second", slug: "second", pluginSlug: "media" }),
				view({ sortOrder: 2, name: "Third", slug: "third", pluginSlug: "media" }),
				view({ sortOrder: 3, name: "Fourth", slug: "fourth", pluginSlug: "media" }),
			],
		};

		expect(workspacePickerSummary(data, "media")).toBe("First, Second, Third +1");
		expect(workspacePickerSummary(data, "fitness")).toBe("Custom workspace · 0 views");
	});

	it.each([
		["/v/recent", "view:recent"],
		["/v/recent/details", "view:recent"],
		["/e/collection-1", "collection:collection-1"],
		["/media", null],
		["/settings", null],
	])("derives the active item from %s", (pathname, key) => {
		expect(activeSidebarKey(pathname)).toBe(key);
	});
});
