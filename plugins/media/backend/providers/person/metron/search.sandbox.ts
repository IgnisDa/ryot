import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Person Search",
	slug: "person.metron.search",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["metronUsername", "metronPassword"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
