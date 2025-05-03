import { describe, expect, it } from "bun:test";
import { createEventFixture } from "#/features/test-fixtures";
import { getEventListViewState, getRecentEvents, sortEvents } from "./model";

describe("sortEvents", () => {
	it("sorts events by occurredAt descending then createdAt descending", () => {
		const events = [
			createEventFixture({
				id: "3",
				createdAt: new Date("2026-03-08T10:10:00.000Z"),
				occurredAt: new Date("2026-03-08T09:00:00.000Z"),
			}),
			createEventFixture({
				id: "1",
				createdAt: new Date("2026-03-08T10:05:00.000Z"),
				occurredAt: new Date("2026-03-08T11:00:00.000Z"),
			}),
			createEventFixture({
				id: "2",
				createdAt: new Date("2026-03-08T10:15:00.000Z"),
				occurredAt: new Date("2026-03-08T11:00:00.000Z"),
			}),
		];

		expect(sortEvents(events).map((event) => event.id)).toEqual([
			"2",
			"1",
			"3",
		]);
	});

	it("returns an empty array for empty input", () => {
		expect(sortEvents([])).toEqual([]);
	});
});

describe("getEventListViewState", () => {
	it("returns empty state when there are no events", () => {
		expect(getEventListViewState([])).toEqual({ type: "empty" });
	});

	it("returns list state with sorted events", () => {
		const state = getEventListViewState([
			createEventFixture({
				id: "older",
				createdAt: new Date("2026-03-08T10:05:00.000Z"),
				occurredAt: new Date("2026-03-08T09:00:00.000Z"),
			}),
			createEventFixture({
				id: "newer",
				createdAt: new Date("2026-03-08T10:15:00.000Z"),
				occurredAt: new Date("2026-03-08T11:00:00.000Z"),
			}),
		]);

		expect(state.type).toBe("list");

		if (state.type !== "list") {
			throw new Error("Expected list state");
		}

		expect(state.events.map((event) => event.id)).toEqual(["newer", "older"]);
	});
});

describe("getRecentEvents", () => {
	it("returns the newest events up to the requested limit", () => {
		const recent = getRecentEvents(
			[
				createEventFixture({
					id: "older",
					createdAt: new Date("2026-03-08T10:05:00.000Z"),
					occurredAt: new Date("2026-03-08T09:00:00.000Z"),
				}),
				createEventFixture({
					id: "newest",
					createdAt: new Date("2026-03-08T10:20:00.000Z"),
					occurredAt: new Date("2026-03-08T11:30:00.000Z"),
				}),
				createEventFixture({
					id: "middle",
					createdAt: new Date("2026-03-08T10:15:00.000Z"),
					occurredAt: new Date("2026-03-08T11:00:00.000Z"),
				}),
			],
			2,
		);

		expect(recent.map((event) => event.id)).toEqual(["newest", "middle"]);
	});
});
