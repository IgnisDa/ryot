import type { entityPageContext } from "@ryot-app/client-sdk/testing";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export const fixturePageContext = (
	page: ReturnType<typeof entityPageContext>,
): ReturnType<typeof entityPageContext> => ({
	...page,
	contributors: [
		{
			kind: "plugin",
			sourceHash: "fixture-source",
			revisionId: "fixture-revision",
			pluginId: PluginId.make("fixture"),
			installationId: "fixture-installation",
			packageId: PluginPackageId.make(PLUGIN_PACKAGE_ID),
		},
	],
});

export const fixtureRoutePageContext = () =>
	fixturePageContext({
		view: null,
		settings: {},
		contributors: [],
		dataSources: null,
		route: { params: {} },
		renderer: { kind: "plugin", exportName: "home", pluginId: "fixture" },
		target: { path: "/", search: "", kind: "plugin-route", pluginId: PluginId.make("fixture") },
	});
