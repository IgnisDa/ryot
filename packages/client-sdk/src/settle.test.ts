import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { RyotScheduleService } from "./schedule";
import { createSettleTracker } from "./settle";
import { advanceRyotSchedule } from "./testing";

describe("createSettleTracker", () => {
	it.effect("keeps staged updates invisible until commit and expires them after the ring", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const tracker = createSettleTracker(schedule, 900);
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

			yield* advanceRyotSchedule(899);
			expect(tracker.snapshot().size).toBe(2);
			yield* advanceRyotSchedule(1);
			expect([...tracker.snapshot()]).toEqual([]);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);

	it.effect("restarts an entity's ring when it settles again", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const tracker = createSettleTracker(schedule, 900);

			tracker.stage({ entityId: "a", reason: "populated" });
			tracker.commit();
			yield* advanceRyotSchedule(600);
			tracker.stage({ entityId: "a", reason: "translated" });
			tracker.commit();

			yield* advanceRyotSchedule(600);
			expect([...tracker.snapshot()]).toEqual([["a", "translating"]]);
			yield* advanceRyotSchedule(300);
			expect([...tracker.snapshot()]).toEqual([]);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);

	it.effect("ignores a commit with nothing staged and stops working once disposed", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const tracker = createSettleTracker(schedule, 900);
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
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);
});
