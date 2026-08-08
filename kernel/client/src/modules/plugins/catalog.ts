import { createRyotQuery } from "@ryot/client-sdk/react";
import {
	pluginClientCatalogRecipe,
	type PluginClientCatalog,
	type PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";
import type { ClientRuntime } from "#/runtime";

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
					try: (signal) => {
						const loadPage = (
							after: string | undefined,
							catalog: PluginClientCatalogEntry[],
						): Promise<PluginClientCatalog> =>
							ryot.data.query(pluginClientCatalogRecipe({ after }), { signal }).then((page) => {
								catalog.push(...page.items);
								if (!page.pageInfo.hasMore) {
									return catalog;
								}
								if (page.pageInfo.nextCursor === null) {
									throw new Error("Plugin catalog page omitted its next cursor");
								}
								return loadPage(page.pageInfo.nextCursor, catalog);
							});

						return loadPage(undefined, []);
					},
				}),
			);

			return { load };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

type PluginCatalogQueryInput = {
	readonly runtime: ClientRuntime;
	readonly initialData: PluginClientCatalog;
};

export const pluginCatalogQuery = createRyotQuery<PluginCatalogQueryInput, PluginClientCatalog>(
	({ client, input, signal }) =>
		input.runtime.runPromise(
			Effect.flatMap(PluginCatalogService, (service) => service.load(client)),
			{ signal },
		),
	{ initialData: (input) => input.initialData },
);
