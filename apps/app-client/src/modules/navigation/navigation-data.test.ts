import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import { describe, expect, it } from "vitest";

import {
	getActiveNavigationKey,
	getCurrentWorkspace,
	getEnabledItems,
	getNavigationHref,
	getNavigationItems,
	getWorkspacePickerSummary,
	getWorkspaceSummary,
} from "./navigation-data";

const data = {
	workspaces: [
		{
			sortOrder: 0,
			name: "Media",
			slug: "media",
			isDisabled: false,
			icon: "clapperboard",
			accentColor: "#fd7e14",
		},
	],
	savedViews: [
		{
			sortOrder: 1,
			icon: "film",
			name: "Movies",
			slug: "movies",
			isDisabled: false,
			pluginSlug: "media",
			accentColor: "#fd7e14",
		},
		{
			sortOrder: 1,
			icon: "dumbbell",
			name: "Training",
			slug: "training",
			isDisabled: false,
			pluginSlug: "fitness",
			accentColor: "#3d6d2f",
		},
		{
			sortOrder: 2,
			icon: "bookmark",
			pluginSlug: null,
			isDisabled: false,
			name: "Everything",
			slug: "everything",
			accentColor: "#a24e08",
		},
		{
			sortOrder: 1,
			name: "Hidden",
			slug: "hidden",
			pluginSlug: null,
			isDisabled: true,
			icon: "bookmark",
			accentColor: "#a24e08",
		},
	],
	collections: [
		{
			sortOrder: 0,
			accentColor: "",
			pluginSlug: null,
			icon: "layers-3",
			isDisabled: false,
			slug: "collection-1",
			name: "Sci-Fi Essentials",
		},
	],
} satisfies NavigationData;

describe("getEnabledItems", () => {
	it("filters disabled items and sorts by sort order", () => {
		expect(
			getEnabledItems([
				...data.workspaces,
				{ ...data.workspaces[0], slug: "disabled", isDisabled: true },
			]).map((item) => item.slug),
		).toEqual(["media"]);
	});
});

describe("getNavigationItems", () => {
	it("builds workspace views and lower global saved views from shared data", () => {
		const items = getNavigationItems({ data, workspaceSlug: "media" });

		expect(items.views.map((item) => item.name)).toEqual(["Home", "Movies"]);
		expect(items.savedViews.map((item) => item.name)).toEqual(["Everything"]);
		expect(items.collections.map((item) => item.slug)).toEqual(["collection-1"]);
	});

	it("formats the workspace view and saved view counts", () => {
		const items = getNavigationItems({ data, workspaceSlug: "media" });

		expect(getWorkspaceSummary(items)).toBe("2 views · 1 saved view");
		expect(getWorkspaceSummary({ ...items, savedViews: [] })).toBe("2 views · no saved views");
	});

	it("formats workspace picker labels from workspace views", () => {
		const items = getNavigationItems({ data, workspaceSlug: "media" });
		const emptyItems = getNavigationItems({ data, workspaceSlug: "missing" });
		const mediaView = items.views.find((item) => item.kind === "view");
		if (!mediaView) {
			throw new Error("Expected a media workspace view");
		}
		const expandedItems = {
			views: [
				...items.views,
				...["Shows", "Books", "Music", "Audio Books", "Video Games", "People"].map((name, index) =>
					Object.assign({}, mediaView, { name, sortOrder: index + 2, slug: `extra-${index}` }),
				),
			],
		};

		expect(getWorkspacePickerSummary(items)).toBe("Movies");
		expect(getWorkspacePickerSummary(expandedItems)).toBe("Movies, Shows, Books +4");
		expect(getWorkspacePickerSummary(emptyItems)).toBe("Custom workspace · 0 views");
	});
});

describe("getCurrentWorkspace", () => {
	it("prefers a valid route and falls back from an invalid persisted workspace", () => {
		expect(getCurrentWorkspace(data.workspaces, "missing", "missing")?.slug).toBe("media");
	});
});

describe("getNavigationHref", () => {
	it("creates workspace-scoped home and entity routes", () => {
		const items = getNavigationItems({ data, workspaceSlug: "media" });

		expect(getNavigationHref("media", items.views[0])).toEqual({
			pathname: "/[workspace]",
			params: { workspace: "media" },
		});
		expect(getNavigationHref("media", items.views[1])).toEqual({
			pathname: "/v/[viewSlug]",
			params: { viewSlug: "movies" },
		});
		expect(getNavigationHref("media", items.collections[0])).toEqual({
			pathname: "/e/[entityId]",
			params: { entityId: "collection-1" },
		});
	});
});

describe("getActiveNavigationKey", () => {
	it.each([
		["/media", "home"],
		["/e/collection-1", "collection:collection-1"],
		["/media/settings", "settings"],
		["/v/movies", "view:movies"],
	])("resolves %s to %s", (pathname, expected) => {
		expect(getActiveNavigationKey(pathname)).toBe(expected);
	});
});
