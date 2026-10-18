import { Effect, Layer } from "effect";

import { unused } from "#/api/ports.test-layer";
import { BackgroundSubmissionService } from "#/modules/background-submissions/service";
import { PluginCalendarSources } from "#/modules/pages/bridge/calendar-sources";
import { PluginEntitySaves } from "#/modules/pages/bridge/entity-saves";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import { PluginPopulationRetries } from "#/modules/pages/bridge/population-retry";
import { PluginQueriesService } from "#/modules/pages/bridge/queries";
import { PluginStorage } from "#/modules/pages/bridge/storage";

export const makePluginQueries = (overrides: Partial<PluginQueriesService["Service"]> = {}) =>
	Layer.succeed(PluginQueriesService, { query: unused, ...overrides });

export const makePluginStorage = (overrides: Partial<PluginStorage["Service"]> = {}) =>
	Layer.succeed(PluginStorage, { outcome: unused, ...overrides });

const makePluginOperations = (overrides: Partial<PluginOperationsService["Service"]> = {}) =>
	Layer.succeed(PluginOperationsService, { invoke: unused, ...overrides });

export const makePluginEntitySaves = (overrides: Partial<PluginEntitySaves["Service"]> = {}) =>
	Layer.succeed(PluginEntitySaves, { outcome: unused, ...overrides });

export const makePluginPopulationRetries = (
	overrides: Partial<PluginPopulationRetries["Service"]> = {},
) => Layer.succeed(PluginPopulationRetries, { outcome: unused, ...overrides });

export const makePluginCalendarSources = (
	overrides: Partial<PluginCalendarSources["Service"]> = {},
) => Layer.succeed(PluginCalendarSources, { outcome: unused, ...overrides });

const emptySnapshot = { entries: [], announcement: "" };

const emptyBackgroundSubmissions = Layer.succeed(BackgroundSubmissionService, {
	open: () =>
		Effect.succeed({
			retry: () => false,
			reserve: () => undefined,
			dismiss: () => undefined,
			dispose: () => undefined,
			subscribe: () => () => undefined,
			getSnapshot: () => emptySnapshot,
		}),
});

export const pluginBridgeServicesTestLayer = Layer.mergeAll(
	emptyBackgroundSubmissions,
	makePluginCalendarSources(),
	makePluginQueries(),
	makePluginStorage(),
	makePluginOperations(),
	makePluginEntitySaves(),
	makePluginPopulationRetries(),
);
