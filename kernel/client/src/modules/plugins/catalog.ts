import { pluginClientCatalogRecipe } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Context, Data, Effect, Layer, Result } from "effect";

import { AuthenticatedApi } from "../../api/authenticated";
import type { ApiScope } from "../../api/scope";

export class PluginCatalogError extends Data.TaggedError("PluginCatalogError")<{
	readonly cause: unknown;
}> {}

export class PluginCatalogService extends Context.Service<PluginCatalogService>()(
	"PluginCatalogService",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			const load = Effect.fn("PluginCatalogService.load")(function* (scope: ApiScope) {
				const recipe = pluginClientCatalogRecipe();
				const response = yield* api.run(scope, (client) =>
					client.ryotql.execute({ payload: recipe.document }),
				);
				const decoded = recipe.decode(response);
				if (Result.isFailure(decoded)) {
					return yield* new PluginCatalogError({ cause: decoded.failure });
				}
				return decoded.success;
			});

			return { load };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
