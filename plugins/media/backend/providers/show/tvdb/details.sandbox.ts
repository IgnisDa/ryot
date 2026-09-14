import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Show Details",
	slug: "show.tvdb.details",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
