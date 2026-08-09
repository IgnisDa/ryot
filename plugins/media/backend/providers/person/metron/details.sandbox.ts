import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Person Details",
	slug: "person.metron.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["metronUsername", "metronPassword"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
