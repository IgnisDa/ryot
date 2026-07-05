import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./metron";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Person Search",
	slug: "person.metron.search",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["metronUsername", "metronPassword"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
