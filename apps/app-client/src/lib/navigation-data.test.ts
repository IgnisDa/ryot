import { describe, expect, it } from "bun:test";
import type { NavigationItem } from "./navigation-data";
import { buildNavigationItems, sortByOrderThenName } from "./navigation-data";

// Minimal fixture factories — only the fields the functions under test inspect.

type TrackerFixture = Parameters<typeof buildNavigationItems>[0][number];
type ViewFixture = Parameters<typeof buildNavigationItems>[1][number];

function makeTracker(partial: {
	id: string;
	name: string;
	slug: string;
	icon: string;
	accentColor: string;
	sortOrder: number;
	isDisabled: boolean;
}): TrackerFixture {
	return partial as TrackerFixture;
}

function makeView(partial: {
	id: string;
	name: string;
	slug: string;
	icon: string;
	accentColor: string;
	sortOrder: number;
	isDisabled: boolean;
	trackerId: string | null;
}): ViewFixture {
	return partial as ViewFixture;
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
		id: "t1",
		name: "Books",
		slug: "books",
		icon: "book",
		accentColor: "#ff0000",
		sortOrder: 0,
		isDisabled: false,
	});

	const view = makeView({
		id: "v1",
		name: "Reading",
		slug: "reading",
		icon: "book-open",
		accentColor: "#0000ff",
		sortOrder: 0,
		isDisabled: false,
		trackerId: "t1",
	});

	it("returns empty arrays when given no trackers or views", () => {
		const result = buildNavigationItems([], []);
		expect(result.trackerItems).toEqual([]);
		expect(result.libraryViews).toEqual([]);
	});

	it("excludes disabled trackers", () => {
		const disabled = makeTracker({ ...tracker, id: "t2", isDisabled: true });
		const { trackerItems } = buildNavigationItems([tracker, disabled], []);
		expect(trackerItems).toHaveLength(1);
		expect(trackerItems[0].key).toBe("t1");
	});

	it("excludes disabled views", () => {
		const disabledView = makeView({ ...view, id: "v2", isDisabled: true });
		const { trackerItems } = buildNavigationItems(
			[tracker],
			[view, disabledView],
		);
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
			id: "t2",
			name: "Games",
			slug: "games",
		});
		const { trackerItems } = buildNavigationItems(
			[tracker, otherTracker],
			[view],
		);
		const books = trackerItems.find((t) => t.key === "t1");
		const games = trackerItems.find((t) => t.key === "t2");
		expect(books?.subItems).toHaveLength(1);
		expect(games?.subItems).toHaveLength(0);
	});

	it("places views with trackerId null into libraryViews", () => {
		const standalone = makeView({ ...view, id: "v2", trackerId: null });
		const { trackerItems, libraryViews } = buildNavigationItems(
			[tracker],
			[view, standalone],
		);
		expect(libraryViews).toHaveLength(1);
		expect(libraryViews[0].key).toBe("v2");
		expect(trackerItems[0].subItems).toHaveLength(1);
	});

	it("sets kind to 'tracker' for tracker items and 'view' for library views", () => {
		const standalone = makeView({ ...view, id: "v2", trackerId: null });
		const { trackerItems, libraryViews } = buildNavigationItems(
			[tracker],
			[standalone],
		);
		expect(trackerItems[0].kind).toBe("tracker");
		expect(libraryViews[0].kind).toBe("view");
	});

	it("sorts trackers by sortOrder then name", () => {
		const t2 = makeTracker({
			...tracker,
			id: "t2",
			name: "Audio",
			slug: "audio",
			sortOrder: 0,
		});
		const t3 = makeTracker({
			...tracker,
			id: "t3",
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
			id: "v2",
			name: "Audiobooks",
			slug: "audiobooks",
			sortOrder: 0,
		});
		const v3 = makeView({
			...view,
			id: "v3",
			name: "Wishlist",
			slug: "wishlist",
			sortOrder: 1,
		});
		const { trackerItems } = buildNavigationItems([tracker], [v3, view, v2]);
		const names = trackerItems[0].subItems.map((s) => s.name);
		expect(names).toEqual(["Audiobooks", "Reading", "Wishlist"]);
	});
});
