import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";

import { SavedViewStructuralRefresh, type SavedViewStructuralRequest } from "./structural-refresh";

const settle = Effect.gen(function* () {
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
});

const request = (
	run: SavedViewStructuralRequest["run"],
	events: string[],
): SavedViewStructuralRequest => ({
	run,
	key: "view:grid",
	canStart: () => true,
	onEnd: Effect.sync(() => void events.push("end")),
	onStart: (manual) => Effect.sync(() => void events.push(manual ? "manual" : "auto")),
});

it.effect("bounds dirty structural data to 30 seconds", () =>
	Effect.gen(function* () {
		const events: string[] = [];
		const service = yield* SavedViewStructuralRefresh.make;
		yield* service.markDirty(request(Effect.succeed(true), events));
		yield* TestClock.adjust("29999 millis");
		yield* settle;

		expect(events).toEqual([]);

		yield* TestClock.adjust("1 millis");
		yield* settle;
		expect(events).toEqual(["auto", "end"]);
	}),
);

it.effect("retains a blocked refresh until activation", () =>
	Effect.gen(function* () {
		let canStart = false;
		const events: string[] = [];
		const service = yield* SavedViewStructuralRefresh.make;
		const work = {
			...request(Effect.succeed(true), events),
			canStart: () => canStart,
		};

		yield* service.refresh(work, false);
		yield* settle;
		expect(events).toEqual([]);

		canStart = true;
		yield* service.activate(work);
		yield* settle;
		expect(events).toEqual(["auto", "end"]);
	}),
);

it.effect("preserves manual intent while a refresh is blocked", () =>
	Effect.gen(function* () {
		let canStart = false;
		const events: string[] = [];
		const service = yield* SavedViewStructuralRefresh.make;
		const work = {
			...request(Effect.succeed(true), events),
			canStart: () => canStart,
		};

		yield* service.refresh(work, false);
		yield* service.refresh(work, true);
		canStart = true;
		yield* service.activate(work);
		yield* settle;

		expect(events).toEqual(["manual", "end"]);
	}),
);

it.effect("starts exactly one trailing refresh when dirtied in flight", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const events: string[] = [];
		const first = yield* Deferred.make<void>();
		const service = yield* SavedViewStructuralRefresh.make;
		const work = request(
			Effect.suspend(() => {
				attempts += 1;
				return attempts === 1 ? Deferred.await(first).pipe(Effect.as(true)) : Effect.succeed(true);
			}),
			events,
		);

		yield* service.refresh(work, true);
		yield* settle;
		yield* service.markDirty(work);
		yield* service.markDirty(work);
		yield* service.refresh(work, false);
		yield* settle;
		expect(attempts).toBe(1);

		yield* Deferred.succeed(first, undefined);
		yield* settle;
		expect(attempts).toBe(2);
		expect(events).toEqual(["manual", "end", "auto", "end"]);
	}),
);

it.effect("retains one manual refresh requested in flight", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const events: string[] = [];
		const first = yield* Deferred.make<void>();
		const service = yield* SavedViewStructuralRefresh.make;
		const work = request(
			Effect.suspend(() => {
				attempts += 1;
				return attempts === 1 ? Deferred.await(first).pipe(Effect.as(true)) : Effect.succeed(true);
			}),
			events,
		);

		yield* service.refresh(work, false);
		yield* settle;
		yield* service.refresh(work, false);
		yield* service.refresh(work, true);
		yield* settle;
		expect(attempts).toBe(1);

		yield* Deferred.succeed(first, undefined);
		yield* settle;
		expect(attempts).toBe(2);
		expect(events).toEqual(["auto", "end", "manual", "end"]);
	}),
);

it.effect("retries a failed refresh after the 30-second dirty bound", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const events: string[] = [];
		const service = yield* SavedViewStructuralRefresh.make;
		const work = request(
			Effect.suspend(() => {
				attempts += 1;
				return attempts === 1 ? Effect.fail("failed") : Effect.succeed(true);
			}),
			events,
		);

		yield* service.refresh(work, false);
		yield* settle;
		expect(attempts).toBe(1);

		yield* TestClock.adjust("29999 millis");
		yield* settle;
		expect(attempts).toBe(1);

		yield* TestClock.adjust("1 millis");
		yield* settle;
		expect(attempts).toBe(2);
		expect(events).toEqual(["auto", "end", "auto", "end"]);
	}),
);

it.effect("does not bypass failed refresh backoff when controller completion activates", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const events: string[] = [];
		const service = yield* SavedViewStructuralRefresh.make;
		const work = request(
			Effect.suspend(() => {
				attempts += 1;
				return attempts === 1 ? Effect.fail("failed") : Effect.succeed(true);
			}),
			events,
		);

		yield* service.refresh(work, false);
		yield* settle;
		expect(attempts).toBe(1);

		// Mirrors use-saved-view activating after the failed controller operation commits idle.
		yield* service.activate(work);
		yield* settle;
		yield* TestClock.adjust("29999 millis");
		yield* settle;
		expect(attempts).toBe(1);

		yield* TestClock.adjust("1 millis");
		yield* settle;
		expect(attempts).toBe(2);
	}),
);

it.effect("never overlaps refresh effects", () =>
	Effect.gen(function* () {
		let active = 0;
		let attempts = 0;
		let maxActive = 0;
		const events: string[] = [];
		const first = yield* Deferred.make<void>();
		const second = yield* Deferred.make<void>();
		const service = yield* SavedViewStructuralRefresh.make;
		const work = request(
			Effect.suspend(() => {
				attempts += 1;
				active += 1;
				maxActive = Math.max(maxActive, active);
				return Deferred.await(attempts === 1 ? first : second).pipe(
					Effect.as(true),
					Effect.ensuring(Effect.sync(() => void (active -= 1))),
				);
			}),
			events,
		);

		yield* service.refresh(work, false);
		yield* settle;
		yield* service.refresh(work, false);
		yield* service.markDirty(work);
		yield* TestClock.adjust("30 seconds");
		yield* settle;
		expect(attempts).toBe(1);
		expect(maxActive).toBe(1);

		yield* Deferred.succeed(first, undefined);
		yield* settle;
		expect(attempts).toBe(2);
		expect(maxActive).toBe(1);

		yield* Deferred.succeed(second, undefined);
		yield* settle;
		expect(active).toBe(0);
	}),
);

it.effect("interrupts refresh and timer fibers when its scope closes", () =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const events: string[] = [];
		const interrupted = yield* Deferred.make<void>();
		const service = yield* SavedViewStructuralRefresh.make.pipe(
			Effect.provideService(Scope.Scope, scope),
		);
		const work = request(
			Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
			events,
		);

		yield* service.refresh(work, false);
		yield* settle;
		yield* service.markDirty(work);
		yield* Scope.close(scope, Exit.void);
		yield* Deferred.await(interrupted);

		expect(events).toEqual(["auto"]);
	}),
);
