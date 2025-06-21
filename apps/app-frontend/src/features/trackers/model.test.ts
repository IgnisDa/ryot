import { describe, expect, it } from "bun:test";
import {
	findEnabledTrackerBySlug,
	selectEnabledTrackers,
	sortTrackersByOrder,
} from "./model";
import { createTrackerFixture } from "./test-fixtures";

const f = createTrackerFixture;

describe("sortTrackersByOrder", () => {
	it("sorts trackers by ascending sortOrder", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media", sortOrder: 3 }),
			f({ id: "2", name: "People", slug: "people" }),
			f({ id: "3", name: "Music", slug: "music", sortOrder: 2 }),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("people");
		expect(sorted[1]?.slug).toBe("music");
		expect(sorted[2]?.slug).toBe("media");
	});

	it("breaks ties by name ascending", () => {
		const trackers = [
			f({ id: "1", name: "Zebra", slug: "zebra" }),
			f({ id: "2", name: "Apple", slug: "apple" }),
			f({ id: "3", name: "Banana", slug: "banana" }),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("apple");
		expect(sorted[1]?.slug).toBe("banana");
		expect(sorted[2]?.slug).toBe("zebra");
	});

	it("breaks name ties by slug ascending", () => {
		const trackers = [
			f({ id: "1", name: "Same", slug: "z-tracker" }),
			f({ id: "2", name: "Same", slug: "a-tracker" }),
			f({ id: "3", name: "Same", slug: "m-tracker" }),
		];

		const sorted = sortTrackersByOrder(trackers);

		expect(sorted[0]?.slug).toBe("a-tracker");
		expect(sorted[1]?.slug).toBe("m-tracker");
		expect(sorted[2]?.slug).toBe("z-tracker");
	});

	it("maintains stable ordering for deterministic nav", () => {
		const trackers = [
			f({ id: "1", name: "Alpha", slug: "slug-a", sortOrder: 5 }),
			f({ id: "2", name: "Beta", slug: "slug-b", sortOrder: 5 }),
			f({ id: "3", name: "Charlie", slug: "slug-c", sortOrder: 5 }),
		];

		const sorted1 = sortTrackersByOrder(trackers);
		const sorted2 = sortTrackersByOrder(trackers);

		expect(sorted1.map((f) => f.slug)).toEqual(sorted2.map((f) => f.slug));
	});
});

describe("selectEnabledTrackers", () => {
	it("filters to only enabled trackers", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({
				id: "2",
				name: "People",
				slug: "people",
				sortOrder: 2,
				isDisabled: true,
			}),
			f({ id: "3", name: "Music", slug: "music", sortOrder: 3 }),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled.length).toBe(2);
		expect(enabled[0]?.slug).toBe("media");
		expect(enabled[1]?.slug).toBe("music");
	});

	it("returns empty array when no trackers are enabled", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media", isDisabled: true }),
			f({
				id: "2",
				name: "People",
				slug: "people",
				sortOrder: 2,
				isDisabled: true,
			}),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled?.length).toBe(0);
	});

	it("returns all trackers when all are enabled", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
		];

		const enabled = selectEnabledTrackers(trackers);

		expect(enabled.length).toBe(2);
	});
});

describe("findEnabledTrackerBySlug", () => {
	it("returns tracker only when enabled", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({
				id: "2",
				name: "Books",
				slug: "books",
				sortOrder: 2,
				isDisabled: true,
			}),
		];

		expect(findEnabledTrackerBySlug(trackers, "media")?.id).toBe("1");
		expect(findEnabledTrackerBySlug(trackers, "books")).toBeUndefined();
	});

	it("returns undefined when slug is not found", () => {
		const trackers = [f({ id: "1", name: "Media", slug: "media" })];

		expect(findEnabledTrackerBySlug(trackers, "nonexistent")).toBeUndefined();
	});

	it("returns undefined for empty trackers array", () => {
		expect(findEnabledTrackerBySlug([], "any-slug")).toBeUndefined();
	});
});
