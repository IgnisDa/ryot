import {
	pluginContributor,
	savedViewPageContext,
	testPluginText,
} from "@ryot-app/plugin-client-sdk/testing";

import type { FitnessText } from "../../client/messages";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { englishCatalog } from "../english-catalog";

/** Renders the plugin's own English catalog, as the client does for an English viewer. */
export const testFitnessText: FitnessText = testPluginText(
	"plugin",
	catalogMessage,
	englishCatalog,
);

const pluginIds = ["fitness", "fitness-owner", "fitness-other", "fitness-next"] as const;

/** The English catalog under each plugin ID the client tests contribute from. */
export const fitnessCatalogs = pluginIds.map((namespace) => ({
	namespace,
	locale: "en" as const,
	catalog: englishCatalog,
}));

/** A saved-view page the Fitness plugin contributes to, so its own messages resolve. */
export const fitnessSavedViewPage = (options: Parameters<typeof savedViewPageContext>[0]) => ({
	...savedViewPageContext(options),
	contributors: [
		pluginContributor({ name: "Fitness", pluginId: "fitness", packageId: PLUGIN_PACKAGE_ID }),
	],
});
