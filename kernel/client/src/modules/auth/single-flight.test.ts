import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeOriginSingleFlight } from "#/modules/auth/single-flight";

const origin = "https://example.com";

describe("origin single flight", () => {
	it.effect("shares one run across concurrent callers for the same origin", () => {
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeOriginSingleFlight<string, never>();
			const compute = Effect.promise(() => {
				runs += 1;
				return Promise.resolve("value");
			});
			const results = yield* Effect.all(
				Array.from({ length: 4 }, () => flight(origin, compute)),
				{ concurrency: "unbounded" },
			);

			expect(results).toEqual(Array.from({ length: 4 }, () => "value"));
			expect(runs).toBe(1);
		});
	});

	it.effect("keys separate origins independently", () => {
		const seen: string[] = [];
		return Effect.gen(function* () {
			const flight = makeOriginSingleFlight<string, never>();
			const run = (server: string) =>
				flight(
					server,
					Effect.sync(() => (seen.push(server), server)),
				);

			expect(yield* Effect.all([run("https://one.test"), run("https://two.test")])).toEqual([
				"https://one.test",
				"https://two.test",
			]);
			expect(seen).toEqual(["https://one.test", "https://two.test"]);
		});
	});

	it.effect("treats equivalent origins as one key", () => {
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeOriginSingleFlight<string, never>();
			const compute = Effect.promise(() => {
				runs += 1;
				return Promise.resolve("value");
			});
			yield* Effect.all([flight("https://example.com", compute), flight(`${origin}/`, compute)], {
				concurrency: "unbounded",
			});

			expect(runs).toBe(1);
		});
	});

	it.effect("releases the key so a later caller starts fresh work", () => {
		let runs = 0;
		return Effect.gen(function* () {
			const flight = makeOriginSingleFlight<number, never>();
			const compute = Effect.sync(() => (runs += 1));

			expect(yield* flight(origin, compute)).toBe(1);
			expect(yield* flight(origin, compute)).toBe(2);
			expect(runs).toBe(2);
		});
	});

	it.effect("finishes detached work even when the only caller is interrupted", () => {
		const release = Deferred.makeUnsafe<void>();
		const finished = Deferred.makeUnsafe<void>();
		const completed: string[] = [];
		return Effect.gen(function* () {
			const flight = makeOriginSingleFlight<string, never>();
			const fiber = yield* Effect.forkChild(
				flight(
					origin,
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
			const flight = makeOriginSingleFlight<string, never>();
			const compute = Effect.gen(function* () {
				runs += 1;
				yield* Deferred.await(release);
				return "value";
			});
			const abandoned = yield* Effect.forkChild(flight(origin, compute), {
				startImmediately: true,
			});
			const surviving = yield* Effect.forkChild(flight(origin, compute), {
				startImmediately: true,
			});

			yield* Fiber.interrupt(abandoned);
			yield* Deferred.succeed(release, undefined);
			expect(yield* Fiber.join(surviving)).toBe("value");
			expect(runs).toBe(1);
		});
	});
});
