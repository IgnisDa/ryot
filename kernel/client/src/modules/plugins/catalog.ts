import { createRyotQuery } from "@ryot-app/client-sdk/react";
import {
	pluginClientCatalogRecipe,
	type PluginClientCatalog,
	type PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer } from "effect";

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
				Effect.gen(function* () {
					const catalog: PluginClientCatalogEntry[] = [];
					let after: string | undefined;
					let hasMore: boolean;
					do {
						const page = yield* ryot.data
							.query(pluginClientCatalogRecipe({ after }))
							.pipe(Effect.mapError((cause) => new PluginCatalogError({ cause })));
						catalog.push(...page.items);
						hasMore = page.pageInfo.hasMore;
						if (hasMore && page.pageInfo.nextCursor === null) {
							return yield* new PluginCatalogError({
								cause: "Plugin catalog page omitted its next cursor",
							});
						}
						after = page.pageInfo.nextCursor ?? undefined;
					} while (hasMore);
					return catalog satisfies PluginClientCatalog;
				}),
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
