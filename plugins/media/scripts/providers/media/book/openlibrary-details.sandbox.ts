import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary Details",
	slug: "book.openlibrary.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
