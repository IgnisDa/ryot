import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary Person Details",
	slug: "person.openlibrary.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
