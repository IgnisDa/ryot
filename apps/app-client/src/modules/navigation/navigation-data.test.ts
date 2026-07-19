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
	it("creates a workspace-scoped home route and standalone view and collection routes", () => {
		const items = getNavigationItems();

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
			params: { entityId: "sci-fi-essentials" },
		});
	});
});

describe("getActiveNavigationKey", () => {
	it.each([
		["/media", "home"],
		["/e/sci-fi-essentials", "collection:sci-fi-essentials"],
		["/media/settings", "settings"],
		["/v/movies", "view:movies"],
	])("resolves %s to %s", (pathname, expected) => {
		expect(getActiveNavigationKey(pathname)).toBe(expected);
	});
});
