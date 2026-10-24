import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeSingleFlight } from "#/modules/auth/single-flight";

describe("authorization single flight", () => {
	it.effect("shares one run across concurrent callers", () => {
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeSingleFlight<string, never>();
			const compute = Effect.promise(() => {
				runs += 1;
				return Promise.resolve("value");
			});
			const results = yield* Effect.all(
				Array.from({ length: 4 }, () => flight(compute)),
				{ concurrency: "unbounded" },
			);

			expect(results).toEqual(Array.from({ length: 4 }, () => "value"));
			expect(runs).toBe(1);
		});
	});

	it.effect("keeps independent authorization flights separate", () => {
		const seen: string[] = [];
		return Effect.gen(function* () {
			const first = makeSingleFlight<string, never>();
			const second = makeSingleFlight<string, never>();

			expect(
				yield* Effect.all([
					first(Effect.sync(() => (seen.push("one"), "one"))),
					second(Effect.sync(() => (seen.push("two"), "two"))),
				]),
			).toEqual(["one", "two"]);
			expect(seen).toEqual(["one", "two"]);
		});
	});

	it.effect("releases completed work so a later caller starts fresh work", () => {
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeSingleFlight<number, never>();
			const compute = Effect.sync(() => (runs += 1));

			expect(yield* flight(compute)).toBe(1);
			expect(yield* flight(compute)).toBe(2);
			expect(runs).toBe(2);
		});
	});

	it.effect("finishes detached work even when the only caller is interrupted", () => {
		const release = Deferred.makeUnsafe<void>();
		const finished = Deferred.makeUnsafe<void>();
		const completed: string[] = [];
		return Effect.gen(function* () {
			const flight = makeSingleFlight<string, never>();
			const fiber = yield* Effect.forkChild(
				flight(
					Effect.gen(function* () {
						yield* Deferred.await(release);
						completed.push("done");
						yield* Deferred.succeed(finished, undefined);
						return "value";
					}),
				),
				{ startImmediately: true },
			);

			yield* Fiber.interrupt(fiber);
			yield* Deferred.succeed(release, undefined);
			yield* Deferred.await(finished);
			expect(completed).toEqual(["done"]);
		});
	});

	it.effect("delivers the result to a surviving caller after another is interrupted", () => {
		const release = Deferred.makeUnsafe<void>();
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeSingleFlight<string, never>();
			const compute = Effect.gen(function* () {
				runs += 1;
				yield* Deferred.await(release);
				return "value";
			});
			const abandoned = yield* Effect.forkChild(flight(compute), { startImmediately: true });
			const surviving = yield* Effect.forkChild(flight(compute), { startImmediately: true });

			yield* Fiber.interrupt(abandoned);
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(surviving)).toBe("value");
			expect(runs).toBe(1);
		});
	});
});
