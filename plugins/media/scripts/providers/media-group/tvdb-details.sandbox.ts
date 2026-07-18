import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Group Details",
	slug: "movie-group.tvdb.details",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
