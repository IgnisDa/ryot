import { decodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { Cause, Context, Effect, FiberSet, Layer, Result } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { LocalInterestSessions } from "./connections";
import { EntityInterestProgression } from "./progression";
import { EntityInterestStore } from "./store";

export class EntityInterestSubscriber extends Context.Service<EntityInterestSubscriber>()(
	"EntityInterestSubscriber",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const redis = yield* RedisService;
			const store = yield* EntityInterestStore;
			const runFork = yield* FiberSet.makeRuntime();
			const sessions = yield* LocalInterestSessions;
			const channel = redisKeys.entityUpdatedChannel;
			const progression = yield* EntityInterestProgression;

			const dispatch = Effect.fn("EntityInterestSubscriber.dispatch")(function* (raw: string) {
				const decoded = decodeEntityUpdatedMessage(raw);
				if (Result.isFailure(decoded)) {
					return;
				}
				const update = decoded.success;
				const message = { type: "entity-updated", ...update } as const;
				const sessionIds = yield* store.listWatchingSessions(update.entityId);
				for (const sessionId of sessionIds) {
					yield* sessions.enqueue(sessionId, message);
				}
				if (update.reason === "populated") {
					yield* progression.populated(update.entityId).pipe(
						Effect.sandbox,
						Effect.retry({ times: 2, while: (cause) => !Cause.hasInterrupts(cause) }),
						Effect.catch((cause) =>
							store
								.markPending({ entityId: update.entityId, sessionIds })
								.pipe(
									Effect.andThen(
										Effect.logError("entity interest progression failed", cause).pipe(
											Effect.annotateLogs({ entityId: update.entityId }),
										),
									),
								),
						),
					);
				}
			});

			const subscriber = redis.client.duplicate();
			subscriber.on("message", (incoming, message) => {
				if (incoming === channel) {
					runFork(
						dispatch(message).pipe(
							Effect.provideService(Database, database),
							Effect.catchCause(Effect.logWarning),
						),
					);
				}
			});
			subscriber.on("ready", () => {
				void subscriber.subscribe(channel).catch(() => undefined);
			});
			yield* Effect.tryPromise(() => subscriber.subscribe(channel)).pipe(Effect.orDie);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => subscriber.removeAllListeners()).pipe(
					Effect.andThen(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
				),
			);

			return { dispatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
