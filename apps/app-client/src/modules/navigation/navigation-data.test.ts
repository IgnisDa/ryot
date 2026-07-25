import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { describe, expect, it } from "vitest";

import {
	getActiveNavigationKey,
	getCurrentWorkspace,
	getEnabledItems,
	getNavigationHref,
	getNavigationItems,
	getWorkspacePickerSummary,
	getWorkspaceSummary,
	mapNavigationResponse,
} from "./navigation-data";

const navigationResponse = {
	data: {
		workspaces: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 2 },
			items: [
				{
					name: { kind: "text", value: "Media" },
					slug: { kind: "text", value: "media" },
					sortOrder: { kind: "null", value: null },
					isDisabled: { kind: "null", value: null },
					icon: { kind: "text", value: "clapperboard" },
					accentColor: { kind: "text", value: "#fd7e14" },
				},
				{
					sortOrder: { kind: "number", value: 2 },
					name: { kind: "text", value: "Fitness" },
					slug: { kind: "text", value: "fitness" },
					icon: { kind: "text", value: "dumbbell" },
					isDisabled: { kind: "boolean", value: true },
					accentColor: { kind: "text", value: "#3d6d2f" },
				},
			],
		},
		savedViews: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 4 },
			items: [
				{
					icon: { kind: "text", value: "film" },
					name: { kind: "text", value: "Movies" },
					slug: { kind: "text", value: "movies" },
					sortOrder: { kind: "number", value: 1 },
					pluginSlug: { kind: "text", value: "media" },
					isDisabled: { kind: "boolean", value: false },
					accentColor: { kind: "text", value: "#fd7e14" },
				},
				{
					sortOrder: { kind: "number", value: 1 },
					name: { kind: "text", value: "Training" },
					slug: { kind: "text", value: "training" },
					icon: { kind: "text", value: "dumbbell" },
					isDisabled: { kind: "boolean", value: false },
					pluginSlug: { kind: "text", value: "fitness" },
					accentColor: { kind: "text", value: "#3d6d2f" },
				},
				{
					sortOrder: { kind: "number", value: 2 },
					icon: { kind: "text", value: "bookmark" },
					pluginSlug: { kind: "null", value: null },
					name: { kind: "text", value: "Everything" },
					slug: { kind: "text", value: "everything" },
					isDisabled: { kind: "boolean", value: false },
					accentColor: { kind: "text", value: "#a24e08" },
				},
				{
					name: { kind: "text", value: "Hidden" },
					slug: { kind: "text", value: "hidden" },
					sortOrder: { kind: "number", value: 1 },
					icon: { kind: "text", value: "bookmark" },
					pluginSlug: { kind: "null", value: null },
					isDisabled: { kind: "boolean", value: true },
					accentColor: { kind: "text", value: "#a24e08" },
				},
			],
		},
		collections: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 2 },
			items: [
				{
					id: { kind: "text", value: "collection-1" },
					name: { kind: "text", value: "Sci-Fi Essentials" },
				},
				{ id: { kind: "number", value: 2 }, name: { kind: "text", value: "Malformed" } },
			],
		},
	},
} satisfies RyotQLResponse;

const data = mapNavigationResponse(navigationResponse);

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

describe("mapNavigationResponse", () => {
	it("maps enabled workspaces, saved views, and collection rows", () => {
		expect(data.workspaces.map((item) => item.slug)).toEqual(["media"]);
		expect(data.workspaces[0]).toMatchObject({ sortOrder: 0, isDisabled: false });
		expect(data.savedViews).toHaveLength(4);
		expect(data.collections.map((item) => ({ name: item.name, slug: item.slug }))).toEqual([
			{ name: "Sci-Fi Essentials", slug: "collection-1" },
		]);
	});

	it("maps valid empty row outputs to empty sections", () => {
		const emptyRows = {
			items: [],
			type: "rows" as const,
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 0 },
		};
		expect(
			mapNavigationResponse({
				data: { workspaces: emptyRows, savedViews: emptyRows, collections: emptyRows },
			}),
		).toEqual({ workspaces: [], savedViews: [], collections: [] });
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
					Object.assign(mediaView, { name, sortOrder: index + 2, slug: `extra-${index}` }),
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
