import {
	decodePluginCatalogInvalidatedMessage,
	encodePluginCatalogInvalidatedMessage,
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, FiberSet, Layer, Queue, Result, Stream } from "effect";

import { Broadcast, broadcastStatement } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";

const catalogTopic = "plugin-catalog";
const encoder = new TextEncoder();
const connected = encoder.encode(`event: ${PLUGIN_CATALOG_CONNECTED_EVENT}\ndata:\n\n`);
const invalidated = encoder.encode(`event: ${PLUGIN_CATALOG_INVALIDATED_EVENT}\ndata:\n\n`);
const heartbeat = encoder.encode(": ping\n\n");

type PluginCatalogInvalidatorValue = {
	readonly all: Effect.Effect<void>;
	readonly user: (userId: UserId) => Effect.Effect<void>;
};

export class PluginCatalogInvalidator extends Context.Service<
	PluginCatalogInvalidator,
	PluginCatalogInvalidatorValue
>()("@ryot-app/kernel-backend/modules/plugins/catalog/events/PluginCatalogInvalidator", {
	make: Effect.succeed({ all: Effect.void, user: (_userId: UserId) => Effect.void }),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export class PluginCatalogHub extends Context.Service<PluginCatalogHub>()(
	"@ryot-app/kernel-backend/modules/plugins/catalog/events/PluginCatalogHub",
	{
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
						Effect.forEach(userQueues, (queue) => Queue.offer(queue, invalidated), {
							discard: true,
						}),
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
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

/** Notifies every process; inside a transaction the notification is sent when it commits. */
export const PluginCatalogInvalidatorLive = Layer.effect(
	PluginCatalogInvalidator,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const publish = (message: string) =>
			session.run((db) => db.execute(broadcastStatement(catalogTopic, message))).pipe(Effect.orDie);
		return {
			all: publish(""),
			user: (userId: UserId) =>
				Effect.fromResult(encodePluginCatalogInvalidatedMessage({ userId })).pipe(
					Effect.orDie,
					Effect.flatMap(publish),
				),
		};
	}),
);

export class PluginInvalidationSubscriber extends Context.Service<PluginInvalidationSubscriber>()(
	"@ryot-app/kernel-backend/modules/plugins/catalog/events/PluginInvalidationSubscriber",
	{
		make: Effect.gen(function* () {
			const broadcast = yield* Broadcast;
			const hub = yield* PluginCatalogHub;
			const runFork = yield* FiberSet.makeRuntime();
			const dispatch = Effect.fn("PluginInvalidationSubscriber.dispatch")(function* (
				message: string,
			) {
				if (message === "") {
					yield* hub.broadcastAll();
					return;
				}
				const decoded = decodePluginCatalogInvalidatedMessage(message);
				if (Result.isSuccess(decoded)) {
					yield* hub.broadcast(decoded.success.userId);
				}
			});
			yield* broadcast.subscribe(catalogTopic, (message) => {
				runFork(dispatch(message));
			});
			yield* broadcast.onReconnect(() => {
				runFork(hub.broadcastAll());
			});
			return { dispatch, subscribed: true as const };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
