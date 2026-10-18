import { decodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { Cause, Context, Effect, FiberSet, Layer, Option, Result, Schema } from "effect";

import { ImpersonationEndedMessage, redisKeys, RedisService } from "#platform/redis";

import { LocalInterestSessions } from "./connections";
import { EntityWatchProgression } from "./progression";
import { EntityWatchStore } from "./store";

export class EntityWatchSubscriber extends Context.Service<EntityWatchSubscriber>()(
	"EntityWatchSubscriber",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const store = yield* EntityWatchStore;
			const runFork = yield* FiberSet.makeRuntime();
			const sessions = yield* LocalInterestSessions;
			const channels = [redisKeys.entityUpdatedChannel, redisKeys.impersonationEndedChannel];
			const progression = yield* EntityWatchProgression;

			const dispatch = Effect.fn("EntityWatchSubscriber.dispatch")(function* (raw: string) {
				const decoded = decodeEntityUpdatedMessage(raw);
				if (Result.isFailure(decoded)) {
					return;
				}
				const update = decoded.success;
				const message = {
					reason: update.reason,
					type: "entity-updated",
					entityId: update.entityId,
				} as const;
				const watchingSessionIds = yield* store.listWatchingSessions(update.entityId);
				const sessionIds =
					update.userId === undefined
						? watchingSessionIds
						: (yield* store.getSessionMetadata(watchingSessionIds))
								.filter((metadata) => metadata.userId === update.userId)
								.map(({ sessionId }) => sessionId);
				for (const sessionId of sessionIds) {
					yield* sessions.enqueue(sessionId, message);
				}
				if (update.reason === "populated") {
					yield* progression.populated(update.entityId).pipe(
						Effect.sandbox,
						Effect.retry({ times: 2, while: (cause) => !Cause.hasInterrupts(cause) }),
						Effect.catch((cause) =>
							store
								.markPending({ sessionIds, entityId: update.entityId })
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
			const dispatchImpersonationEnded = Effect.fn(
				"EntityWatchSubscriber.dispatchImpersonationEnded",
			)(function* (raw: string) {
				const decoded = Schema.decodeOption(ImpersonationEndedMessage)(raw);
				if (Option.isSome(decoded)) {
					yield* sessions.closeAuthSession(decoded.value.sessionId);
				}
			});

			const subscriber = redis.client.duplicate();
			subscriber.on("message", (incoming, message) => {
				if (incoming === redisKeys.entityUpdatedChannel) {
					runFork(dispatch(message).pipe(Effect.catchCause(Effect.logWarning)));
				} else if (incoming === redisKeys.impersonationEndedChannel) {
					runFork(dispatchImpersonationEnded(message).pipe(Effect.catchCause(Effect.logWarning)));
				}
			});
			subscriber.on("ready", () => {
				runFork(Effect.tryPromise(() => subscriber.subscribe(...channels)).pipe(Effect.ignore));
			});
			yield* Effect.tryPromise(() => subscriber.subscribe(...channels)).pipe(Effect.orDie);
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
