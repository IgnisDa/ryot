import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Show Translation",
	slug: "show.tvdb.translate",
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
