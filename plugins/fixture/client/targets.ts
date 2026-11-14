import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const fixtureRoute = (path: string, search?: Record<string, string>) => ({
	path,
	search,
	packageId: PLUGIN_PACKAGE_ID,
	kind: "plugin-route" as const,
});
