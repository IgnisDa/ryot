import { Effect, Layer } from "effect";

import { PluginCatalogEventsService } from "#/modules/plugins/events";

export const makePluginCatalogEventsTestLayer = () => {
	let subscriptionCount = 0;
	const listeners = new Set<() => void>();

	return {
		isSubscribed: () => listeners.size > 0,
		getSubscriptionCount: () => subscriptionCount,
		send: () => {
			for (const listener of listeners) {
				listener();
			}
		},
		layer: Layer.succeed(PluginCatalogEventsService, {
			subscribe: (_scope, onCatalogChanged) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						subscriptionCount += 1;
						listeners.add(onCatalogChanged);
					}),
					() => Effect.sync(() => listeners.delete(onCatalogChanged)),
				).pipe(Effect.andThen(Effect.never), Effect.scoped),
		}),
	};
};
