import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "OpenLibrary Resolve",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "book.openlibrary.resolve",
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
