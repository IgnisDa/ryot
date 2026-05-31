import { describe, expect, it } from "bun:test";

import { SavedViewId, TrackerId } from "@ryot/contract/schema/brands";

import type { NavigationItem } from "./navigation-data";
import { buildNavigationItems, navHref, sortByOrderThenName } from "./navigation-data";

type TrackerFixture = Parameters<typeof buildNavigationItems>[0][number];
type ViewFixture = Parameters<typeof buildNavigationItems>[1][number];

function makeTracker(
	partial: Pick<
		TrackerFixture,
		"id" | "name" | "slug" | "icon" | "accentColor" | "sortOrder" | "isDisabled"
	>,
): TrackerFixture {
	// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
	return partial as unknown as TrackerFixture;
}

function makeView(
	partial: Pick<
		ViewFixture,
		"id" | "name" | "slug" | "icon" | "accentColor" | "sortOrder" | "isDisabled" | "trackerId"
	>,
): ViewFixture {
	// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
	return partial as unknown as ViewFixture;
}

describe("sortByOrderThenName", () => {
	it("sorts by sortOrder ascending", () => {
		const items = [
			{ sortOrder: 2, name: "Beta" },
			{ sortOrder: 1, name: "Alpha" },
		];
		expect(sortByOrderThenName(items)).toEqual([
			{ sortOrder: 1, name: "Alpha" },
			{ sortOrder: 2, name: "Beta" },
		]);
	});

	it("breaks ties by name alphabetically", () => {
		const items = [
			{ sortOrder: 1, name: "Zed" },
			{ sortOrder: 1, name: "Alpha" },
			{ sortOrder: 1, name: "Mango" },
		];
		const names = sortByOrderThenName(items).map((i) => i.name);
		expect(names).toEqual(["Alpha", "Mango", "Zed"]);
	});

	it("does not mutate the input array", () => {
		const items = [
			{ sortOrder: 2, name: "B" },
			{ sortOrder: 1, name: "A" },
		];
		sortByOrderThenName(items);
		expect(items[0].name).toBe("B");
	});

	it("returns an empty array for empty input", () => {
		expect(sortByOrderThenName([])).toEqual([]);
	});
});

describe("buildNavigationItems", () => {
	const tracker = makeTracker({
		icon: "book",
		sortOrder: 0,
		name: "Books",
		slug: "books",
		isDisabled: false,
		accentColor: "#ff0000",
		id: TrackerId.make("t1"),
	});

	const view = makeView({
		sortOrder: 0,
		name: "Reading",
		slug: "reading",
		icon: "book-open",
		isDisabled: false,
		accentColor: "#0000ff",
		id: SavedViewId.make("v1"),
		trackerId: TrackerId.make("t1"),
	});

	it("returns empty arrays when given no trackers or views", () => {
		const result = buildNavigationItems([], []);
		expect(result.trackerItems).toEqual([]);
		expect(result.libraryViews).toEqual([]);
	});

	it("excludes disabled trackers", () => {
		const disabled = makeTracker({ ...tracker, id: TrackerId.make("t2"), isDisabled: true });
		const { trackerItems } = buildNavigationItems([tracker, disabled], []);
		expect(trackerItems).toHaveLength(1);
		expect(trackerItems[0].key).toBe("t1");
	});

	it("excludes disabled views", () => {
		const disabledView = makeView({ ...view, id: SavedViewId.make("v2"), isDisabled: true });
		const { trackerItems } = buildNavigationItems([tracker], [view, disabledView]);
		expect(trackerItems[0].subItems).toHaveLength(1);
		expect(trackerItems[0].subItems[0].key).toBe("v1");
	});

	it("attaches views to their parent tracker as subItems", () => {
		const { trackerItems } = buildNavigationItems([tracker], [view]);
		expect(trackerItems[0].subItems).toHaveLength(1);
		expect(trackerItems[0].subItems[0]).toMatchObject({
			key: "v1",
			slug: "reading",
			name: "Reading",
			icon: "book-open",
			accentColor: "#0000ff",
		});
	});

	it("does not attach a view to a different tracker", () => {
		const otherTracker = makeTracker({
			...tracker,
			id: TrackerId.make("t2"),
			name: "Games",
			slug: "games",
		});
		const { trackerItems } = buildNavigationItems([tracker, otherTracker], [view]);
		const books = trackerItems.find((t) => t.key === "t1");
		const games = trackerItems.find((t) => t.key === "t2");
		expect(books?.subItems).toHaveLength(1);
		expect(games?.subItems).toHaveLength(0);
	});

	it("places views with trackerId null into libraryViews", () => {
		const standalone = makeView({ ...view, id: SavedViewId.make("v2"), trackerId: null });
		const { trackerItems, libraryViews } = buildNavigationItems([tracker], [view, standalone]);
		expect(libraryViews).toHaveLength(1);
		expect(libraryViews[0].key).toBe("v2");
		expect(trackerItems[0].subItems).toHaveLength(1);
	});

	it("sets kind to 'tracker' for tracker items and 'view' for library views", () => {
		const standalone = makeView({ ...view, id: SavedViewId.make("v2"), trackerId: null });
		const { trackerItems, libraryViews } = buildNavigationItems([tracker], [standalone]);
		expect(trackerItems[0].kind).toBe("tracker");
		expect(libraryViews[0].kind).toBe("view");
	});

	it("sorts trackers by sortOrder then name", () => {
		const t2 = makeTracker({
			...tracker,
			id: TrackerId.make("t2"),
			name: "Audio",
			slug: "audio",
			sortOrder: 0,
		});
		const t3 = makeTracker({
			...tracker,
			id: TrackerId.make("t3"),
			name: "Video",
			slug: "video",
			sortOrder: 1,
		});
		const { trackerItems } = buildNavigationItems([t3, tracker, t2], []);
		const names = trackerItems.map((t: NavigationItem) => t.name);
		expect(names).toEqual(["Audio", "Books", "Video"]);
	});

	it("sorts subItems within a tracker by sortOrder then name", () => {
		const v2 = makeView({
			...view,
			sortOrder: 0,
			name: "Audiobooks",
			slug: "audiobooks",
			id: SavedViewId.make("v2"),
		});
		const v3 = makeView({
			...view,
			sortOrder: 1,
			name: "Wishlist",
			slug: "wishlist",
			id: SavedViewId.make("v3"),
		});
		const { trackerItems } = buildNavigationItems([tracker], [v3, view, v2]);
		const names = trackerItems[0].subItems.map((s) => s.name);
		expect(names).toEqual(["Audiobooks", "Reading", "Wishlist"]);
	});
});

function makeItem(partial: Partial<NavigationItem>): NavigationItem {
	return {
		key: "k",
		name: "Name",
		icon: "icon",
		slug: "slug",
		kind: "home",
		subItems: [],
		accentColor: null,
		...partial,
	};
}

describe("navHref", () => {
	it('returns "/" for home items', () => {
		expect(navHref(makeItem({ kind: "home" }))).toBe("/");
	});

	it('returns "/views/<slug>" for view items', () => {
		expect(navHref(makeItem({ kind: "view", slug: "reading" }))).toBe("/views/reading");
	});

	it('returns "/tracker/<slug>" for tracker items', () => {
		expect(navHref(makeItem({ kind: "tracker", slug: "books" }))).toBe("/tracker/books");
	});

	it('returns "/tracker/<slug>" for user items (falls through to tracker branch)', () => {
		expect(navHref(makeItem({ kind: "user", slug: "user" }))).toBe("/tracker/user");
	});
});
