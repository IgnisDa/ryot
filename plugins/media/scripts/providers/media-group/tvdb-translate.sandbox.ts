import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { translate } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Group Translate",
	slug: "movie-group.tvdb.translate",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
