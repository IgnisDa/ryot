import { PgClient } from "@effect/sql-pg";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sql } from "drizzle-orm";
import { Cause, Context, Duration, Effect, Layer, Schedule, Schema, Stream } from "effect";

import { PgClientLive } from "./db/postgres";

const broadcastChannel = "ryot_broadcast";

const decodeFrame = Schema.decodeOption(
	Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);
const encodeFrame = (topic: string, message: string) => stableStringify([topic, message]);

/**
 * A statement that tells every process something. PostgreSQL delivers it when the surrounding transaction commits,
 * and never if it rolls back; delivery is not durable, so listeners must recover on reconnect.
 */
export const broadcastStatement = (topic: string, message = "") =>
	sql`select pg_notify(${broadcastChannel}, ${encodeFrame(topic, message)})`;

type Listener = (message: string) => void;

const add = <A>(group: Set<A>, value: A) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			group.add(value);
		}),
		() =>
			Effect.sync(() => {
				group.delete(value);
			}),
	);

/** One `LISTEN` connection per process, shared by every topic. */
export class Broadcast extends Context.Service<Broadcast>()(
	"@ryot-app/kernel-backend/platform/broadcast",
	{
		make: Effect.gen(function* () {
			const pg = yield* PgClient.PgClient;
			const topics = new Map<string, Set<Listener>>();
			const reconnects = new Set<() => void>();

			const dispatch = (payload: string) => {
				const frame = decodeFrame(payload);
				if (frame._tag === "Some") {
					for (const listener of topics.get(frame.value[0]) ?? []) {
						listener(frame.value[1]);
					}
				}
			};

			let connected = false;
			yield* Effect.scoped(
				Effect.gen(function* () {
					const notifications = yield* pg.listen(broadcastChannel);
					if (connected) {
						for (const listener of reconnects) {
							listener();
						}
					}
					connected = true;
					yield* Stream.fromQueue(notifications).pipe(
						Stream.runForEach(({ payload }) => Effect.sync(() => dispatch(payload))),
					);
				}),
			).pipe(
				Effect.tapCause((cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.void
						: Effect.logWarning("broadcast listener lost its connection", cause),
				),
				Effect.retry(Schedule.spaced(Duration.seconds(1))),
				Effect.forkScoped,
			);

			return {
				/** Calls `listener` after the connection comes back, since messages sent meanwhile are gone. */
				onReconnect: (listener: () => void) => add(reconnects, listener),
				/** Sends now, or when the current transaction commits. */
				publish: (topic: string, message = "") =>
					pg`select pg_notify(${broadcastChannel}, ${encodeFrame(topic, message)})`.pipe(
						Effect.asVoid,
					),
				subscribe: (topic: string, listener: Listener) =>
					Effect.suspend(() => {
						const listeners = topics.get(topic) ?? new Set<Listener>();
						topics.set(topic, listeners);
						return add(listeners, listener);
					}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgClientLive));
}
