import { expect, layer } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { makeSandboxShortWait } from "./short-wait";

layer(TestClock.layer())((test) => {
	test.effect("bounds sequential and parallel waits with the short wait budget", () =>
		Effect.gen(function* () {
			const sequential = makeSandboxShortWait();
			expect(yield* sequential.wait(0)).toBe(true);
			expect(yield* sequential.wait(1_001)).toBe(false);
			expect(yield* sequential.wait(-1)).toBe(false);
			expect(yield* sequential.wait(0.5)).toBe(false);

			const first = yield* Effect.forkChild(sequential.wait(600));
			yield* TestClock.adjust("600 millis");
			expect(yield* Fiber.join(first)).toBe(true);

			const second = yield* Effect.forkChild(sequential.wait(400));
			yield* TestClock.adjust("400 millis");
			expect(yield* Fiber.join(second)).toBe(true);
			expect(yield* sequential.wait(1)).toBe(false);

			const fullBudget = makeSandboxShortWait();
			const fullWait = yield* Effect.forkChild(fullBudget.wait(1_000));
			yield* TestClock.adjust("1 second");
			expect(yield* Fiber.join(fullWait)).toBe(true);

			const parallel = makeSandboxShortWait();
			const parallelFirst = yield* Effect.forkChild(parallel.wait(750));
			const parallelSecond = yield* Effect.forkChild(parallel.wait(750));
			const parallelWaits = [parallelFirst, parallelSecond];
			yield* TestClock.adjust("750 millis");
			const parallelResults = yield* Effect.forEach(parallelWaits, Fiber.join);
			expect(parallelResults.filter(Boolean)).toHaveLength(1);
			expect(parallelResults).toContain(false);
		}),
	);

	test.effect("refunds the unused allowance when a short wait is interrupted", () =>
		Effect.gen(function* () {
			const budget = makeSandboxShortWait();
			const waiting = yield* Effect.forkChild(budget.wait(1_000));
			yield* TestClock.adjust("250 millis");
			yield* Fiber.interrupt(waiting);

			const refundedWait = yield* Effect.forkChild(budget.wait(750));
			yield* TestClock.adjust("750 millis");
			expect(yield* Fiber.join(refundedWait)).toBe(true);
			expect(yield* budget.wait(1)).toBe(false);
		}),
	);
});
