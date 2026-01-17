import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Company Search",
	slug: "company.tvdb.search",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfigValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
