import type { PluginId } from "@ryot-app/client-sdk/plugin";

export const fixtureRoute = (
	pluginId: PluginId,
	path: string,
	search?: Record<string, string>,
) => ({ path, search, pluginId, kind: "plugin-route" as const });
