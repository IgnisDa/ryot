import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./vndb";

export const manifest = defineManifest({
	kind: "provider",
	name: "VNDB Visual Novel Details",
	slug: "visual-novel.vndb.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
