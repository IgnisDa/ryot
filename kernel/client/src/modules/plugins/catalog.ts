import { pluginClientCatalogRecipe } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "../../api/ryot-client";

export class PluginCatalogError extends Data.TaggedError("PluginCatalogError")<{
	readonly cause: unknown;
}> {}

export class PluginCatalogService extends Context.Service<PluginCatalogService>()(
	"PluginCatalogService",
	{
		make: Effect.sync(() => {
			const load = Effect.fn("PluginCatalogService.load")((ryot: KernelRyotClient) =>
				Effect.tryPromise({
					catch: (cause) => new PluginCatalogError({ cause }),
					try: () => ryot.data.query(pluginClientCatalogRecipe()),
				}),
			);

			return { load };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
