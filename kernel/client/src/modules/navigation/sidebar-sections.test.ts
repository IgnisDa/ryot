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
			savedViews: [
				view({ name: "Later", slug: "later", sortOrder: 4, pluginSlug: "media" }),
				view({ name: "Global", slug: "global", sortOrder: 2 }),
				view({ name: "First", slug: "first", sortOrder: -1, pluginSlug: "media" }),
				view({ name: "Other", slug: "other", pluginSlug: "fitness" }),
				view({ name: "Hidden", slug: "hidden", isDisabled: true, pluginSlug: "media" }),
			],
			collections: [
				collection({ name: "Second Collection", slug: "second", sortOrder: 2 }),
				collection({ name: "First Collection", slug: "first-collection", sortOrder: 1 }),
				collection({ name: "Hidden Collection", slug: "hidden-collection", isDisabled: true }),
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
			data: { savedViews: [], collections: [] },
			workspaceSlug: undefined,
		});

		expect(sections.views.map(sidebarItemKey)).toEqual(["home"]);
		expect(workspaceSummary(sections)).toBe("1 view");
	});

	it("formats a workspace picker summary from enabled views in sort order", () => {
		const data: NavigationData = {
			savedViews: [
				view({ name: "Fourth", slug: "fourth", sortOrder: 4, pluginSlug: "media" }),
				view({
					sortOrder: 0,
					name: "Disabled",
					slug: "disabled",
					isDisabled: true,
					pluginSlug: "media",
				}),
				view({ name: "Second", slug: "second", sortOrder: 2, pluginSlug: "media" }),
				view({ name: "Other", slug: "other", sortOrder: 1, pluginSlug: "fitness" }),
				view({ name: "First", slug: "first", sortOrder: 1, pluginSlug: "media" }),
			],
			collections: [],
		};

		expect(workspacePickerSummary(data, "media")).toBe("First, Second, Fourth");
		expect(workspacePickerSummary(data, "fitness")).toBe("Other");
	});

	it("adds the remaining count and handles empty workspaces", () => {
		const data: NavigationData = {
			savedViews: [
				view({ name: "First", slug: "first", sortOrder: 0, pluginSlug: "media" }),
				view({ name: "Second", slug: "second", sortOrder: 1, pluginSlug: "media" }),
				view({ name: "Third", slug: "third", sortOrder: 2, pluginSlug: "media" }),
				view({ name: "Fourth", slug: "fourth", sortOrder: 3, pluginSlug: "media" }),
			],
			collections: [],
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
