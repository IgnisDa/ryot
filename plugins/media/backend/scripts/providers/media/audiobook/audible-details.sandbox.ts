import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./audible";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible Details",
	slug: "audiobook.audible.details",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
