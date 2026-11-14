import type { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { PluginUserPreferences } from "@ryot-app/plugin-client-contract";

import { createRyotQuery } from "./definitions";
import { useRyotQuery } from "./hooks";

const pluginUserSettingsQuery = createRyotQuery<PluginId, Readonly<Record<string, JsonValue>>>(
	({ input, client }) => client.userSettings(input),
);

export const usePluginUserSettings = (pluginId: PluginId) =>
	useRyotQuery(pluginUserSettingsQuery, pluginId);

const userPreferencesQuery = createRyotQuery<void, PluginUserPreferences>(
	({ client }) => client.userPreferences,
);

export const useUserPreferences = () => useRyotQuery(userPreferencesQuery);
