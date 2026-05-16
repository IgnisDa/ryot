import { describe, expect, it } from "vitest";

import {
	getActiveNavigationKey,
	getEnabledItems,
	getNavigationHref,
	getNavigationItems,
	navigationData,
} from "./navigation-data";

describe("getEnabledItems", () => {
	it("filters disabled items and sorts by sort order", () => {
		const items = [
			{ ...navigationData.views[2], kind: "view" as const },
			{ ...navigationData.views[1], kind: "view" as const, isDisabled: true },
			{ ...navigationData.views[0], kind: "home" as const },
		];

		expect(getEnabledItems(items).map((item) => item.slug)).toEqual(["home", "shows"]);
	});
});

describe("getNavigationItems", () => {
	it("builds shared groups for desktop and mobile navigation", () => {
		const items = getNavigationItems();

		expect(items.views.slice(0, 4).map((item) => item.name)).toEqual([
			"Home",
			"Movies",
			"Shows",
			"Books",
		]);
		expect(items.collections).toHaveLength(5);
		expect(items.savedViews).toHaveLength(5);
	});
});

describe("getNavigationHref", () => {
	it("creates workspace-scoped routes for views and collections", () => {
		const items = getNavigationItems();

		expect(getNavigationHref("media", items.views[0])).toEqual({
			pathname: "/[workspace]",
			params: { workspace: "media" },
		});
		expect(getNavigationHref("media", items.views[1])).toEqual({
			pathname: "/[workspace]/views/[viewSlug]",
			params: { viewSlug: "movies", workspace: "media" },
		});
		expect(getNavigationHref("media", items.collections[0])).toEqual({
			pathname: "/[workspace]/collections/[collectionSlug]",
			params: { collectionSlug: "sci-fi-essentials", workspace: "media" },
		});
	});
});

describe("getActiveNavigationKey", () => {
	it.each([
		["/media", "home"],
		["/media/views/movies", "view:movies"],
		["/media/collections/backlog", "collection:backlog"],
		["/media/settings", "settings"],
	])("resolves %s to %s", (pathname, expected) => {
		expect(getActiveNavigationKey(pathname)).toBe(expected);
	});
});
