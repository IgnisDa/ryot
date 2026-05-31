import { Effect, Either } from "effect";

import { notFound } from "#lib/errors";
import { decodeEntityUpdatedMessage, redisKeys, RedisService } from "#lib/redis";
import type { UserId } from "#lib/schema/brands";

import type { EntityUpdatedFrame } from "./messages";

export type StreamEnqueue = (frame: EntityUpdatedFrame) => void;

type StreamEntry = {
	readonly userId: UserId;
	readonly enqueue: StreamEnqueue;
	interest: Set<string>;
};

// Per-process registry of which SSE streams want which entities, plus the single duplicated Redis
// subscriber that fans entity:updated messages out to the local streams that declared interest.
// streamId is assumed unique per connection: the client generates a fresh UUID per stream.
export class StreamRegistry extends Effect.Service<StreamRegistry>()("StreamRegistry", {
	scoped: Effect.gen(function* () {
		const redis = yield* RedisService;
		const channel = redisKeys.entityUpdatedChannel;

		const streams = new Map<string, StreamEntry>();
		// Forward index: entity id -> interested stream ids (used by the fan-out).
		const byEntity = new Map<string, Set<string>>();

		const add = (streamId: string, userId: UserId, enqueue: StreamEnqueue): void => {
			streams.set(streamId, { userId, enqueue, interest: new Set() });
		};

		// Unknown streamId and wrong-owner are intentionally both "not found", to avoid an oracle for
		// which streamIds exist. Diffs against the stream's prior interest so only real changes touch
		// the forward index.
		const setInterestIfOwner = (streamId: string, userId: UserId, entityIds: readonly string[]) => {
			const entry = streams.get(streamId);
			if (!entry || entry.userId !== userId) {
				return notFound("Unknown stream");
			}
			const next = new Set(entityIds);
			for (const id of entry.interest) {
				if (!next.has(id)) {
					const ids = byEntity.get(id);
					ids?.delete(streamId);
					if (ids?.size === 0) {
						byEntity.delete(id);
					}
				}
			}
			for (const id of next) {
				if (!entry.interest.has(id)) {
					const ids = byEntity.get(id) ?? new Set<string>();
					ids.add(streamId);
					byEntity.set(id, ids);
				}
			}
			entry.interest = next;
			return Effect.void;
		};

		const hasInterest = (streamId: string, entityId: string): boolean =>
			streams.get(streamId)?.interest.has(entityId) ?? false;

		const remove = (streamId: string): void => {
			const entry = streams.get(streamId);
			if (entry) {
				for (const id of entry.interest) {
					const ids = byEntity.get(id);
					ids?.delete(streamId);
					if (ids?.size === 0) {
						byEntity.delete(id);
					}
				}
			}
			streams.delete(streamId);
		};

		const fanOut = (raw: string): void => {
			const decoded = decodeEntityUpdatedMessage(raw);
			if (Either.isLeft(decoded)) {
				return;
			}
			const { entityId, reason } = decoded.right;
			const streamIds = byEntity.get(entityId);
			if (!streamIds) {
				return;
			}
			for (const streamId of streamIds) {
				streams.get(streamId)?.enqueue({ entityId, reason });
			}
		};

		const subscriber = redis.client.duplicate();
		subscriber.on("message", (incoming, message) => {
			if (incoming === channel) {
				fanOut(message);
			}
		});
		// ioredis restores subscriptions on reconnect, but re-subscribing on `ready` is idempotent and
		// guards against any gap.
		subscriber.on("ready", () => {
			void subscriber.subscribe(channel).catch(() => undefined);
		});
		yield* Effect.tryPromise(() => subscriber.subscribe(channel)).pipe(Effect.orDie);

		const teardown = Effect.sync(() => {
			subscriber.removeAllListeners();
			streams.clear();
			byEntity.clear();
		});
		yield* Effect.addFinalizer(() =>
			teardown.pipe(
				Effect.zipRight(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
			),
		);

		return { add, remove, setInterestIfOwner, hasInterest };
	}),
}) {}
