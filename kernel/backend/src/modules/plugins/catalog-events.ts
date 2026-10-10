import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
} from "@ryot-app/contract/modules/plugins/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, inArray, isNull } from "drizzle-orm";
import { Cause, Context, Effect, FiberSet, Layer, Queue, Result, Stream } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

const encoder = new TextEncoder();
const connected = encoder.encode(`event: ${PLUGIN_CATALOG_CONNECTED_EVENT}\ndata:\n\n`);
const invalidated = encoder.encode(`event: ${PLUGIN_CATALOG_INVALIDATED_EVENT}\ndata:\n\n`);
const heartbeat = encoder.encode(": ping\n\n");

export class PluginCatalogHub extends Context.Service<PluginCatalogHub>()("PluginCatalogHub", {
	make: Effect.sync(() => {
		const queues = new Map<UserId, Set<Queue.Queue<Uint8Array>>>();

		const subscribe = Effect.fn("PluginCatalogHub.subscribe")((userId: UserId) =>
			Effect.acquireRelease(
				Effect.gen(function* () {
					const queue = yield* Queue.unbounded<Uint8Array>();
					const userQueues = queues.get(userId) ?? new Set();
					userQueues.add(queue);
					queues.set(userId, userQueues);
					yield* Queue.offer(queue, connected);
					return queue;
				}),
				(queue) =>
					Effect.sync(() => {
						const userQueues = queues.get(userId);
						userQueues?.delete(queue);
						if (userQueues?.size === 0) {
							queues.delete(userId);
						}
					}).pipe(Effect.andThen(Queue.shutdown(queue))),
			),
		);
		const broadcast = Effect.fn("PluginCatalogHub.broadcast")((userId: UserId) =>
			Effect.forEach(queues.get(userId) ?? [], (queue) => Queue.offer(queue, invalidated), {
				discard: true,
			}),
		);
		const broadcastAll = Effect.fn("PluginCatalogHub.broadcastAll")(() =>
			Effect.forEach(
				queues.values(),
				(userQueues) =>
					Effect.forEach(userQueues, (queue) => Queue.offer(queue, invalidated), { discard: true }),
				{ discard: true },
			),
		);
		const stream = (userId: UserId) =>
			Stream.unwrap(
				subscribe(userId).pipe(
					Effect.map((queue) =>
						Stream.fromQueue(queue).pipe(
							Stream.merge(
								Stream.fromEffect(Effect.sleep("25 seconds").pipe(Effect.as(heartbeat))).pipe(
									Stream.forever,
								),
							),
						),
					),
				),
			).pipe(Stream.scoped);

		return { stream, broadcast, subscribe, broadcastAll };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

type PluginCatalogInvalidatorValue = {
	readonly all: Effect.Effect<void>;
	readonly user: (userId: UserId) => Effect.Effect<void>;
	readonly recordAll: Effect.Effect<void>;
	readonly recordUser: (userId: UserId) => Effect.Effect<void>;
	readonly deliverPending: (limit: number) => Effect.Effect<void>;
};

export class PluginCatalogInvalidator extends Context.Service<
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorValue
>()("PluginCatalogInvalidator", {
	make: Effect.succeed({
		all: Effect.void,
		recordAll: Effect.void,
		user: (_userId: UserId) => Effect.void,
		recordUser: (_userId: UserId) => Effect.void,
		deliverPending: (_limit: number) => Effect.void,
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

const logPublishFailure = Effect.catchCause((cause) =>
	Effect.logError("plugin catalog invalidation publish failed", cause),
);

export const PluginCatalogInvalidatorLive = Layer.effect(
	PluginCatalogInvalidator,
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const session = yield* DatabaseSession;
		const record = (userId: UserId | null) =>
			Effect.gen(function* () {
				yield* session.requireTransaction;
				yield* session.run((db) => db.insert(schema.pluginCatalogChange).values({ userId }));
			});
		const publish = (userId: UserId | null) =>
			userId === null
				? redis.publish(redisKeys.pluginCatalogChannel, "plugin-catalog-invalidated")
				: redis.publish(
						redisKeys.pluginCatalogUserChannel,
						encodePluginCatalogInvalidatedMessage({ userId }),
					);
		const deliver = Effect.fn("PluginCatalogInvalidator.deliver")(function* (
			userId: UserId | null,
			limit: number,
		) {
			const rows = yield* session.run((db) =>
				db
					.select({ id: schema.pluginCatalogChange.id })
					.from(schema.pluginCatalogChange)
					.where(
						userId === null
							? isNull(schema.pluginCatalogChange.userId)
							: eq(schema.pluginCatalogChange.userId, userId),
					)
					.orderBy(schema.pluginCatalogChange.createdAt, schema.pluginCatalogChange.id)
					.limit(limit),
			);
			if (rows.length === 0) {
				return;
			}
			yield* publish(userId);
			yield* session.run((db) =>
				db.delete(schema.pluginCatalogChange).where(
					inArray(
						schema.pluginCatalogChange.id,
						rows.map(({ id }) => id),
					),
				),
			);
		});
		const deliverPending = Effect.fn("PluginCatalogInvalidator.deliverPending")(function* (
			limit: number,
		) {
			const pending = yield* session.run((db) =>
				db
					.select({ userId: schema.pluginCatalogChange.userId })
					.from(schema.pluginCatalogChange)
					.orderBy(schema.pluginCatalogChange.createdAt, schema.pluginCatalogChange.id)
					.limit(limit),
			);
			for (const scopeUserId of new Set(pending.map(({ userId }) => userId))) {
				yield* deliver(scopeUserId === null ? null : UserId.make(scopeUserId), limit).pipe(
					Effect.catchCause((cause) =>
						Effect.logError("plugin catalog delivery failed", cause).pipe(
							Effect.annotateLogs({ userId: scopeUserId }),
						),
					),
				);
			}
		});
		return {
			recordAll: record(null).pipe(Effect.orDie),
			all: deliver(null, 100).pipe(logPublishFailure),
			recordUser: (userId: UserId) => record(userId).pipe(Effect.orDie),
			user: (userId: UserId) => deliver(userId, 100).pipe(logPublishFailure),
			deliverPending: (limit: number) => deliverPending(limit).pipe(Effect.orDie),
		};
	}),
);

export class PluginInvalidationSubscriber extends Context.Service<PluginInvalidationSubscriber>()(
	"PluginInvalidationSubscriber",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const hub = yield* PluginCatalogHub;
			const runFork = yield* FiberSet.makeRuntime();
			const subscriber = redis.client.duplicate();
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => subscriber.removeAllListeners()).pipe(
					Effect.andThen(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
				),
			);
			const channels = [redisKeys.pluginCatalogUserChannel, redisKeys.pluginCatalogChannel];
			const dispatch = Effect.fn("PluginInvalidationSubscriber.dispatch")(function* (
				incoming: string,
				message: string,
			) {
				if (incoming === redisKeys.pluginCatalogChannel) {
					yield* hub.broadcastAll();
					return;
				}
				if (incoming !== redisKeys.pluginCatalogUserChannel) {
					return;
				}
				const decoded = decodePluginCatalogInvalidatedMessage(message);
				if (Result.isSuccess(decoded)) {
					yield* hub.broadcast(decoded.success.userId);
				}
			});
			const subscribeAndBroadcast = Effect.tryPromise(() => subscriber.subscribe(...channels)).pipe(
				Effect.andThen(hub.broadcastAll()),
			);
			const recover = subscribeAndBroadcast.pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) => Effect.logError("plugin invalidation subscription failed", cause),
				),
			);
			subscriber.on("message", (incoming, message) =>
				runFork(
					dispatch(incoming, message).pipe(
						Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), Effect.logError),
					),
				),
			);
			subscriber.on("ready", () => runFork(recover));
			yield* subscribeAndBroadcast;
			return { recover, dispatch, subscribed: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
