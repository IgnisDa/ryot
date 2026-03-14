import { describe, expect, it } from "bun:test";
import {
	findEnabledTrackerBySlug,
	selectEnabledTrackers,
	sortTrackersByOrder,
} from "./model";
import { createTrackerFixture } from "./test-fixtures";

const f = createTrackerFixture;
const mkTracker = (
	id: string,
	name: string,
	slug: string,
	sortOrder = 1,
	enabled = true,
) => f({ id, name, slug, enabled, sortOrder });

describe("sortTrackersByOrder", () => {
	it("sorts trackers by ascending sortOrder", () => {
		const trackers = [
			mkTracker("1", "Media", "media", 3),
			mkTracker("2", "People", "people"),
			mkTracker("3", "Music", "music", 2),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("people");
		expect(sorted[1]?.slug).toBe("music");
		expect(sorted[2]?.slug).toBe("media");
	});

	it("breaks ties by name ascending", () => {
		const trackers = [
			mkTracker("1", "Zebra", "zebra"),
			mkTracker("2", "Apple", "apple"),
			mkTracker("3", "Banana", "banana"),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("apple");
		expect(sorted[1]?.slug).toBe("banana");
		expect(sorted[2]?.slug).toBe("zebra");
	});

	it("breaks name ties by slug ascending", () => {
		const trackers = [
			mkTracker("1", "Same", "z-tracker"),
			mkTracker("2", "Same", "a-tracker"),
			mkTracker("3", "Same", "m-tracker"),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("a-tracker");
		expect(sorted[1]?.slug).toBe("m-tracker");
		expect(sorted[2]?.slug).toBe("z-tracker");
	});

	it("maintains stable ordering for deterministic nav", () => {
		const trackers = [
			mkTracker("1", "Alpha", "slug-a", 5),
			mkTracker("2", "Beta", "slug-b", 5),
			mkTracker("3", "Charlie", "slug-c", 5),
		];

		const sorted1 = sortTrackersByOrder(trackers);
		const sorted2 = sortTrackersByOrder(trackers);

		expect(sorted1.map((f) => f.slug)).toEqual(sorted2.map((f) => f.slug));
	});
});

describe("selectEnabledTrackers", () => {
	it("filters to only enabled trackers", () => {
		const trackers = [
			mkTracker("1", "Media", "media"),
			mkTracker("2", "People", "people", 2, false),
			mkTracker("3", "Music", "music", 3),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled.length).toBe(2);
		expect(enabled[0]?.slug).toBe("media");
		expect(enabled[1]?.slug).toBe("music");
	});

	it("returns empty array when no trackers are enabled", () => {
		const trackers = [
			mkTracker("1", "Media", "media", 1, false),
			mkTracker("2", "People", "people", 2, false),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled?.length).toBe(0);
	});

	it("returns all trackers when all are enabled", () => {
		const trackers = [
			mkTracker("1", "Media", "media"),
			mkTracker("2", "People", "people", 2),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled.length).toBe(2);
	});
});

describe("findEnabledTrackerBySlug", () => {
	it("returns tracker only when enabled", () => {
		const trackers = [
			mkTracker("1", "Media", "media", 1, true),
			mkTracker("2", "Books", "books", 2, false),
		];

		expect(findEnabledTrackerBySlug(trackers, "media")?.id).toBe("1");
		expect(findEnabledTrackerBySlug(trackers, "books")).toBeUndefined();
	});

	it("returns undefined when slug is not found", () => {
		const trackers = [mkTracker("1", "Media", "media", 1, true)];

		expect(findEnabledTrackerBySlug(trackers, "nonexistent")).toBeUndefined();
	});

	it("returns undefined for empty trackers array", () => {
		expect(findEnabledTrackerBySlug([], "any-slug")).toBeUndefined();
	});
});
