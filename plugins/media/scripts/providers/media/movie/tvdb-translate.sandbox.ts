import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { translate } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Translation",
	slug: "movie.tvdb.translate",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfigValue"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
