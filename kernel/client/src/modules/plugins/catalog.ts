import {
	pluginClientCatalogRecipe,
	type PluginClientCatalog,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";

import type { KernelRyotClient } from "../../api/ryot-client";
import type { ClientRuntime } from "../../runtime";

const catalogRefreshInterval = 1_000;

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

export const makePluginCatalogAtom = (
	runtime: ClientRuntime,
	ryot: KernelRyotClient,
	initialValue: PluginClientCatalog,
) =>
	Atom.make(
		Effect.tryPromise({
			catch: (cause) => new PluginCatalogError({ cause }),
			try: (signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
					{
						signal,
					},
				),
		}),
		{ initialValue },
	).pipe(Atom.withRefresh(catalogRefreshInterval));
