import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Layer } from "effect";

import { PluginCatalogService } from "#/modules/plugins/catalog/service";

export const makePluginCatalog = (catalog: PluginClientCatalog) =>
	Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) });
