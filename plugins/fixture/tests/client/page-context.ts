import { type entityPageContext, pluginContributor } from "@ryot-app/plugin-client-sdk/testing";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export const fixturePageContext = (
	page: ReturnType<typeof entityPageContext>,
): ReturnType<typeof entityPageContext> => ({
	...page,
	contributors: [
		pluginContributor({ name: "fixture", pluginId: "fixture", packageId: PLUGIN_PACKAGE_ID }),
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
		target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
	});
