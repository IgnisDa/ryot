import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot/contract/modules/plugins/contract";
import { Context, Effect, Layer } from "effect";

import { serverApiUrl } from "#/api/origin";
import { canonicalApiScope, type ApiScope } from "#/api/scope";

type CatalogEventSource = {
	readonly close: () => void;
	readonly addEventListener: (type: string, listener: () => void) => void;
};
type CatalogEventSourceFactory = (url: string, options: EventSourceInit) => CatalogEventSource;

const makePluginCatalogEventsService = (open: CatalogEventSourceFactory) => ({
	subscribe: (scope: ApiScope, onCatalogChanged: () => void) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const canonical = canonicalApiScope(scope);
				const source = open(`${serverApiUrl(canonical.serverUrl)}/plugins/events`, {
					withCredentials: true,
				});
				source.addEventListener(PLUGIN_CATALOG_CONNECTED_EVENT, onCatalogChanged);
				source.addEventListener(PLUGIN_CATALOG_INVALIDATED_EVENT, onCatalogChanged);
				return source;
			}),
			(source) => Effect.sync(() => source.close()),
		).pipe(Effect.andThen(Effect.never), Effect.scoped),
});

export class PluginCatalogEventsService extends Context.Service<
	PluginCatalogEventsService,
	{ readonly subscribe: (scope: ApiScope, onCatalogChanged: () => void) => Effect.Effect<never> }
>()("PluginCatalogEventsService") {
	static readonly layer = Layer.succeed(
		this,
		makePluginCatalogEventsService((url, options) => new EventSource(url, options)),
	);
}

export const makePluginCatalogEventsLayer = (open: CatalogEventSourceFactory) =>
	Layer.succeed(PluginCatalogEventsService, makePluginCatalogEventsService(open));
