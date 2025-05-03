import { describe, expect, it } from "bun:test";
import { applyTrackerIsDisabledPatch, applyTrackerReorderPatch } from "./cache";
import { createTrackerFixture } from "./test-fixtures";

const f = createTrackerFixture;

describe("applyTrackerIsDisabledPatch", () => {
	it("updates target tracker isDisabled status only", () => {
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

		const result = applyTrackerIsDisabledPatch(trackers, "2", false);

		expect(result[0]).toEqual(trackers[0]);
		expect(result[1]?.isDisabled).toBe(false);
		expect(result[1]?.id).toBe("2");
		expect(result[2]).toEqual(trackers[2]);
	});

	it("maintains immutability of input array", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({
				id: "2",
				name: "People",
				slug: "people",
				sortOrder: 2,
				isDisabled: true,
			}),
		];

		const originalIsDisabled = trackers[0]?.isDisabled;
		const result = applyTrackerIsDisabledPatch(trackers, "1", true);

		expect(trackers[0]?.isDisabled).toBe(originalIsDisabled);
		expect(result[0]?.isDisabled).toBe(true);
		expect(result).not.toBe(trackers);
	});

	it("maintains immutability of tracker objects", () => {
		const trackers = [f({ id: "1", name: "Media", slug: "media" })];

		const result = applyTrackerIsDisabledPatch(trackers, "1", true);

		expect(result[0]).not.toBe(trackers[0]);
	});
});

describe("applyTrackerReorderPatch", () => {
	it("applies requested order to trackers", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
			f({ id: "3", name: "Music", slug: "music", sortOrder: 3 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["3", "1", "2"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
	});

	it("reassigns sortOrder starting at 1", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media", sortOrder: 10 }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 20 }),
			f({ id: "3", name: "Music", slug: "music", sortOrder: 30 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "3", "1"]);

		expect(result[0]?.sortOrder).toBe(1);
		expect(result[1]?.sortOrder).toBe(2);
		expect(result[2]?.sortOrder).toBe(3);
	});

	it("ignores unknown ids safely", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["1", "999", "2"]);

		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe("1");
		expect(result[1]?.id).toBe("2");
	});

	it("appends unspecified trackers in prior relative order", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
			f({ id: "3", name: "Music", slug: "music", sortOrder: 3 }),
			f({ id: "4", name: "Books", slug: "books", sortOrder: 4 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["3", "1"]);

		expect(result[0]?.id).toBe("3");
		expect(result[1]?.id).toBe("1");
		expect(result[2]?.id).toBe("2");
		expect(result[3]?.id).toBe("4");
	});

	it("maintains immutability of input array", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "1"]);

		expect(result).not.toBe(trackers);
		expect(trackers[0]?.id).toBe("1");
		expect(trackers[1]?.id).toBe("2");
	});

	it("maintains immutability of tracker objects", () => {
		const trackers = [
			f({ id: "1", name: "Media", slug: "media" }),
			f({ id: "2", name: "People", slug: "people", sortOrder: 2 }),
		];

		const result = applyTrackerReorderPatch(trackers, ["2", "1"]);

		expect(result[0]).not.toBe(trackers[1]);
		expect(result[1]).not.toBe(trackers[0]);
	});
});
