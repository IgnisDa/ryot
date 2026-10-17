import { Layer } from "effect";

import { unused } from "#/api/ports.test-layer";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import { PluginQueriesService } from "#/modules/pages/bridge/queries";
import { PluginStorage } from "#/modules/pages/bridge/storage";

export const makePluginQueries = (overrides: Partial<PluginQueriesService["Service"]> = {}) =>
	Layer.succeed(PluginQueriesService, { query: unused, ...overrides });

export const makePluginStorage = (overrides: Partial<PluginStorage["Service"]> = {}) =>
	Layer.succeed(PluginStorage, { outcome: unused, ...overrides });

export const makePluginOperations = (overrides: Partial<PluginOperationsService["Service"]> = {}) =>
	Layer.succeed(PluginOperationsService, { invoke: unused, ...overrides });
