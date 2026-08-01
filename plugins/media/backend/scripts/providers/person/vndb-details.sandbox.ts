import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./vndb";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "VNDB Person Details",
	slug: "person.vndb.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
