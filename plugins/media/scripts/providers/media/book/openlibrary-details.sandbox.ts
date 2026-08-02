import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "OpenLibrary Details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "book.openlibrary.details",
});

export default defineProvider({ manifest, operation: "details", run: details.run });
