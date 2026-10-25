import { createRyotHostQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	type PluginClientCatalog,
	pluginClientCatalogRecipe,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Context, Effect, Layer, Schema } from "effect";

import { loadAllPages } from "#/api/load-all-pages";
import type { KernelRyotClient } from "#/api/ryot-client";
import { KernelHostServices } from "#/host-services";

export class PluginCatalogError extends Schema.TaggedError<
	PluginCatalogError,
	{ readonly brand: unique symbol }
>()("PluginCatalogError", { cause: Schema.Unknown }) {}

export class PluginCatalogService extends Context.Service<PluginCatalogService>()(
	"@ryot-app/kernel-client/modules/plugins/catalog/service/PluginCatalogService",
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

export const pluginCatalogQuery = createRyotHostQuery<
	PluginClientCatalog,
	PluginClientCatalog,
	KernelHostServices,
	PluginCatalogError
>(({ client, hostServices }) => hostServices.runtime.runSync(PluginCatalogService).load(client), {
	cancelOnUnmount: true,
	initialData: (input) => input,
	hostServices: KernelHostServices,
});
