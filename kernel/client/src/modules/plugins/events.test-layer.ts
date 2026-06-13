import { Effect, Layer } from "effect";

import { PluginCatalogEventsService } from "#/modules/plugins/events";

export const makePluginCatalogEventsTestLayer = () => {
	const listeners = new Set<() => void>();

	return {
		isSubscribed: () => listeners.size > 0,
		send: () => {
			for (const listener of listeners) {
				listener();
			}
		},
		layer: Layer.succeed(PluginCatalogEventsService, {
			subscribe: (_scope, onCatalogChanged) =>
				Effect.acquireRelease(
					Effect.sync(() => listeners.add(onCatalogChanged)),
					() => Effect.sync(() => listeners.delete(onCatalogChanged)),
				).pipe(Effect.andThen(Effect.never), Effect.scoped),
		}),
	};
};
