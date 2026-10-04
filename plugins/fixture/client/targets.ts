import { PluginPackageId } from "@ryot-app/client-sdk/plugin";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const fixtureRoute = (path: string, search?: Record<string, string>) => ({
	path,
	search,
	kind: "plugin-route" as const,
	packageId: PluginPackageId.make(PLUGIN_PACKAGE_ID),
});
