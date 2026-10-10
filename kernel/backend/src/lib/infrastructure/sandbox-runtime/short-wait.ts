import { Clock, Duration, Effect } from "effect";

import { SANDBOX_LIMITS } from "./limits";

export const makeSandboxShortWait = () => {
	let remainingMs: number = SANDBOX_LIMITS.replay.shortWaitMs;
	const wait = Effect.fnUntraced(function* (durationMs: number) {
		if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > remainingMs) {
			return false;
		}
		remainingMs -= durationMs;
		const clock = yield* Clock.Clock;
		const started = yield* clock.monotonicTimeNanos;
		return yield* Effect.sleep(Duration.millis(durationMs)).pipe(
			Effect.as(true),
			Effect.ensuring(
				Effect.map(clock.monotonicTimeNanos, (finished) => {
					const elapsedMs = Number(finished - started) / 1_000_000;
					remainingMs = Math.max(0, remainingMs + durationMs - elapsedMs);
				}),
			),
		);
	});
	return { wait };
};

export type SandboxShortWait = ReturnType<typeof makeSandboxShortWait>;
