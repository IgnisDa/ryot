import { decodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Context, Effect, FiberSet, Layer, Result } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { LocalStreamConnections } from "./connections";
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
			const channel = redisKeys.entityUpdatedChannel;
			const connections = yield* LocalStreamConnections;
			const progression = yield* EntityInterestProgression;

			const dispatch = Effect.fn("EntityInterestSubscriber.dispatch")(function* (raw: string) {
				const decoded = decodeEntityUpdatedMessage(raw);
				if (Result.isFailure(decoded)) {
					return;
				}
				const frame = decoded.success;
				const streamIds = yield* store.listInterestedStreams(frame.entityId);
				for (const streamId of streamIds) {
					yield* connections.enqueue(streamId, frame);
				}
				if (frame.reason === "populated") {
					yield* progression.populated(frame.entityId).pipe(
						Effect.sandbox,
						Effect.retry({
							times: 2,
							while: (cause) => !Cause.hasInterrupts(cause),
						}),
						Effect.catch((cause) =>
							store
								.markPending({ entityId: frame.entityId, streamIds })
								.pipe(
									Effect.andThen(
										Effect.logError("entity interest progression failed", cause).pipe(
											Effect.annotateLogs({ entityId: frame.entityId }),
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
