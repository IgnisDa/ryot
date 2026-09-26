import { Clock, Duration, Effect, Schema } from "effect";
import { DurableClock } from "effect/unstable/workflow";

import { makeActivity } from "./workflow-scope";

export const startWorkflowDeadline = (name: string, durationMs: number) =>
	makeActivity({
		success: Schema.Finite,
		name: `deadline-${name}`,
		execute: Clock.currentTimeMillis.pipe(Effect.map((now) => now + durationMs)),
	});

export const observeWorkflowDeadline = Effect.fnUntraced(function* <A, E, R>(options: {
	readonly name: string;
	readonly deadline: number;
	readonly poll: Effect.Effect<A | null, E, R>;
	readonly completedAt: (value: A) => number | null;
}) {
	for (let pollNumber = 0; ; pollNumber += 1) {
		const result = yield* options.poll;
		if (result !== null) {
			const completedAt = options.completedAt(result);
			if (completedAt === null || completedAt < options.deadline) {
				return { value: result, status: "completed" as const };
			}
			return { status: "expired" as const };
		}
		const remaining = options.deadline - (yield* Clock.currentTimeMillis);
		if (remaining <= 0) {
			return { status: "expired" as const };
		}
		yield* DurableClock.sleep({
			inMemoryThreshold: Duration.zero,
			name: `deadline-poll-${options.name}-${pollNumber}`,
			duration: Duration.millis(Math.min(1000, remaining)),
		});
	}
});
