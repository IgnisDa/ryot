import { createRyotQuery } from "@ryot-app/client-sdk/react";
import {
	pluginClientCatalogRecipe,
	type PluginClientCatalog,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer } from "effect";

import { loadAllPages } from "#/api/load-all-pages";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { KernelHostServices } from "#/host-services";

export class PluginCatalogError extends Data.TaggedError("PluginCatalogError")<{
	readonly cause: unknown;
}> {}

export class PluginCatalogService extends Context.Service<PluginCatalogService>()(
	"PluginCatalogService",
	{
		make: Effect.sync(() => {
			const load = Effect.fn("PluginCatalogService.load")((ryot: KernelRyotClient) =>
				loadAllPages((after) => ryot.data.query(pluginClientCatalogRecipe({ after }))).pipe(
					Effect.mapError((cause) => new PluginCatalogError({ cause })),
				),
			);

			return { load };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const pluginCatalogQuery = createRyotQuery<
	PluginClientCatalog,
	PluginClientCatalog,
	KernelHostServices,
	PluginCatalogError
>(({ client, hostServices }) => hostServices.runtime.runSync(PluginCatalogService).load(client), {
	cancelOnUnmount: true,
	initialData: (input) => input,
});
