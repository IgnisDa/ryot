import { describe, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { waitForImpersonationExpiry } from "#/modules/auth/impersonation-expiry";

describe("impersonation session expiry", () => {
	it.effect("checks the deadline again after a resume wake-up", () =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis;
			const resumed = yield* Deferred.make<void>();
			const laterResume = yield* Deferred.make<void>();
			let waits = 0;
			const fiber = yield* Effect.forkChild(
				waitForImpersonationExpiry(now + 1000, () => {
					waits += 1;
					return Deferred.await(waits === 1 ? resumed : laterResume);
				}),
				{ startImmediately: true },
			);

			yield* TestClock.adjust("400 millis");
			yield* Deferred.succeed(resumed, undefined);
			yield* TestClock.adjust("1 millis");
			expect(waits).toBe(2);
			yield* TestClock.adjust("599 millis");
			yield* Fiber.join(fiber);
			expect(waits).toBe(2);
		}),
	);
});
