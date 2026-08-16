import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect, Layer } from "effect";

import { unused } from "#/api/ports.test-layer";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";

export const makePluginQueries = (overrides: Partial<PluginQueriesService["Service"]> = {}) =>
	Layer.succeed(PluginQueriesService, { query: unused, ...overrides });

export const makePluginOperations = (overrides: Partial<PluginOperationsService["Service"]> = {}) =>
	Layer.succeed(PluginOperationsService, { invoke: unused, ...overrides });

export const makePluginCatalog = (catalog: PluginClientCatalog) =>
	Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) });
