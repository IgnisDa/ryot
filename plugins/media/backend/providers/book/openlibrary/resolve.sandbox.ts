import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "OpenLibrary Resolve",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "book.openlibrary.resolve",
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
