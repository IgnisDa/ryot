import { describe, expect, it } from "bun:test";
import { applyTrackerEnabledPatch, applyTrackerReorderPatch } from "./cache";
import { createTrackerFixture } from "./test-fixtures";

const f = createTrackerFixture;
const tracker = (
	id: string,
	name: string,
	slug: string,
	sortOrder = 1,
	enabled = true,
) => f({ id, name, slug, enabled, sortOrder });

describe("applyTrackerEnabledPatch", () => {
	it("updates target tracker enabled status only", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2, false),
			tracker("3", "Music", "music", 3),
		];

		const result = applyTrackerEnabledPatch(trackers, "2", true);

		expect(result[0]).toEqual(trackers[0]);
		expect(result[1]?.enabled).toBe(true);
		expect(result[1]?.id).toBe("2");
		expect(result[2]).toEqual(trackers[2]);
	});

	it("maintains immutability of input array", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2, false),
		];

		const originalEnabled = trackers[0]?.enabled;
		const result = applyTrackerEnabledPatch(trackers, "1", false);

		expect(trackers[0]?.enabled).toBe(originalEnabled);
		expect(result[0]?.enabled).toBe(false);
		expect(result).not.toBe(trackers);
	});

	it("maintains immutability of tracker objects", () => {
		const trackers = [tracker("1", "Media", "media")];

		const result = applyTrackerEnabledPatch(trackers, "1", false);

		expect(result[0]).not.toBe(trackers[0]);
	});
});

describe("applyTrackerReorderPatch", () => {
	it("applies requested order to trackers", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2),
			tracker("3", "Music", "music", 3),
		];

		const result = applyTrackerReorderPatch(trackers, ["3", "1", "2"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
	});

	it("reassigns sortOrder starting at 1", () => {
		const trackers = [
			tracker("1", "Media", "media", 10),
			tracker("2", "People", "people", 20),
			tracker("3", "Music", "music", 30),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "3", "1"]);

		expect(result[0]?.sortOrder).toBe(1);
		expect(result[1]?.sortOrder).toBe(2);
		expect(result[2]?.sortOrder).toBe(3);
	});

	it("ignores unknown ids safely", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2),
		];

		const result = applyTrackerReorderPatch(trackers, ["1", "999", "2"]);

		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe("1");
		expect(result[1]?.id).toBe("2");
	});

	it("appends unspecified trackers in prior relative order", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2),
			tracker("3", "Music", "music", 3),
			tracker("4", "Books", "books", 4),
		];

		const result = applyTrackerReorderPatch(trackers, ["3", "1"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
		expect(result[3]?.id).toBe("4");
	});

	it("maintains immutability of input array", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "1"]);

		expect(result).not.toBe(trackers);
		expect(trackers[0]?.id).toBe("1");
		expect(trackers[1]?.id).toBe("2");
	});

	it("maintains immutability of tracker objects", () => {
		const trackers = [
			tracker("1", "Media", "media"),
			tracker("2", "People", "people", 2),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "1"]);

		expect(result[0]).not.toBe(trackers[1]);
		expect(result[1]).not.toBe(trackers[0]);
	});
});
