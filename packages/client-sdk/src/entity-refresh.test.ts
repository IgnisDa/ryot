import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { createEntityRefresh } from "./entity-refresh";
import type { EntityUpdate } from "./index";
import { RyotScheduleService } from "./schedule";
import { advanceRyotSchedule } from "./testing";

const populated = (entityId: string): EntityUpdate => ({ entityId, reason: "populated" });

describe("createEntityRefresh", () => {
	it.effect("batches and dedupes the hints that land inside one window", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const batches: EntityUpdate[][] = [];
			const refresh = createEntityRefresh(schedule, (updates) => {
				batches.push([...updates]);
				return Promise.resolve();
			});

			refresh.hint(populated("a"));
			refresh.hint({ entityId: "a", reason: "translated" });
			refresh.hint(populated("b"));
			yield* advanceRyotSchedule(250);

			expect(batches).toEqual([
				[
					{ entityId: "a", reason: "translated" },
					{ entityId: "b", reason: "populated" },
				],
			]);

			refresh.hint(populated("c"));
			yield* advanceRyotSchedule(250);
			expect(batches).toHaveLength(2);
			expect(batches[1]).toEqual([populated("c")]);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);

	it.effect("delivers an empty batch for a hint that carries no update", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const batches: EntityUpdate[][] = [];
			const refresh = createEntityRefresh(schedule, (updates) => {
				batches.push([...updates]);
				return Promise.resolve();
			});

			refresh.hint();
			yield* advanceRyotSchedule(250);

			expect(batches).toEqual([[]]);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);

	it.effect("keeps blocked updates queued and merges them with newer ones", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			const batches: EntityUpdate[][] = [];
			const refresh = createEntityRefresh(schedule, (updates) => {
				batches.push([...updates]);
				return Promise.resolve();
			});

			refresh.block(true);
			refresh.hint(populated("a"));
			yield* advanceRyotSchedule(1_000);
			expect(batches).toEqual([]);

			refresh.hint(populated("b"));
			refresh.block(false);
			yield* advanceRyotSchedule(250);

			expect(batches).toEqual([[populated("a"), populated("b")]]);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);

	it.effect("drops queued work once disposed", () =>
		Effect.gen(function* () {
			const schedule = yield* RyotScheduleService;
			let calls = 0;
			const refresh = createEntityRefresh(schedule, () => {
				calls++;
				return Promise.resolve();
			});

			refresh.hint(populated("a"));
			refresh.dispose();
			yield* advanceRyotSchedule(1_000);

			expect(calls).toBe(0);
		}).pipe(Effect.provide(RyotScheduleService.layer)),
	);
});
