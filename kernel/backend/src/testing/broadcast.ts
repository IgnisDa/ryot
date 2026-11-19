import { Duration, Effect, Queue, Schedule } from "effect";

import { Broadcast } from "#platform/broadcast";

/** Waits until this process's `LISTEN` connection hears its own messages. */
export const awaitBroadcastListening = Effect.gen(function* () {
	const broadcast = yield* Broadcast;
	const heard = yield* Queue.unbounded<void>();
	yield* broadcast.subscribe("test-ready", () => {
		Queue.offerUnsafe(heard, undefined);
	});
	yield* broadcast
		.publish("test-ready")
		.pipe(
			Effect.andThen(Queue.take(heard).pipe(Effect.timeout(Duration.millis(100)))),
			Effect.retry(Schedule.recurs(50)),
			Effect.orDie,
		);
});
