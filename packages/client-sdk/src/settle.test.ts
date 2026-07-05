import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettleTracker } from "./settle";

afterEach(() => {
	vi.useRealTimers();
});

describe("createSettleTracker", () => {
	it("keeps staged updates invisible until commit and expires them after the ring", () => {
		vi.useFakeTimers();
		const tracker = createSettleTracker(900);
		let notifications = 0;
		tracker.subscribe(() => {
			notifications++;
		});

		tracker.stage({ entityId: "a", reason: "populated" });
		tracker.stage({ entityId: "b", reason: "translated" });
		expect([...tracker.snapshot()]).toEqual([]);
		expect(notifications).toBe(0);

		tracker.commit();
		expect([...tracker.snapshot()]).toEqual([
			["a", "populating"],
			["b", "translating"],
		]);
		expect(notifications).toBe(1);

		vi.advanceTimersByTime(899);
		expect(tracker.snapshot().size).toBe(2);
		vi.advanceTimersByTime(1);
		expect([...tracker.snapshot()]).toEqual([]);
	});

	it("restarts an entity's ring when it settles again", () => {
		vi.useFakeTimers();
		const tracker = createSettleTracker(900);

		tracker.stage({ entityId: "a", reason: "populated" });
		tracker.commit();
		vi.advanceTimersByTime(600);
		tracker.stage({ entityId: "a", reason: "translated" });
		tracker.commit();

		vi.advanceTimersByTime(600);
		expect([...tracker.snapshot()]).toEqual([["a", "translating"]]);
		vi.advanceTimersByTime(300);
		expect([...tracker.snapshot()]).toEqual([]);
	});

	it("ignores a commit with nothing staged and stops working once disposed", () => {
		vi.useFakeTimers();
		const tracker = createSettleTracker(900);
		let notifications = 0;
		tracker.subscribe(() => {
			notifications++;
		});

		tracker.commit();
		expect(notifications).toBe(0);

		tracker.stage({ entityId: "a", reason: "populated" });
		tracker.dispose();
		tracker.stage({ entityId: "b", reason: "populated" });
		tracker.commit();

		expect([...tracker.snapshot()]).toEqual([]);
		expect(notifications).toBe(0);
	});
});
