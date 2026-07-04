import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
	encodePluginCatalogInvalidatedMessage,
} from "@ryot/contract/modules/plugins/contract";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Queue, Stream } from "effect";

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

		return { broadcast, broadcastAll, stream, subscribe };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

type PluginCatalogInvalidatorValue = {
	readonly all: Effect.Effect<void>;
	readonly user: (userId: UserId) => Effect.Effect<void>;
};

export class PluginCatalogInvalidator extends Context.Service<
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorValue
>()("PluginCatalogInvalidator", {
	make: Effect.succeed({
		all: Effect.void,
		user: (_userId: UserId) => Effect.void,
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
		return {
			all: redis
				.publish(redisKeys.pluginRegistryChannel, "plugin-catalog-invalidated")
				.pipe(Effect.asVoid, logPublishFailure),
			user: (userId: UserId) =>
				redis
					.publish(
						redisKeys.pluginCatalogUserChannel,
						encodePluginCatalogInvalidatedMessage({ userId }),
					)
					.pipe(Effect.asVoid, logPublishFailure),
		};
	}),
);
