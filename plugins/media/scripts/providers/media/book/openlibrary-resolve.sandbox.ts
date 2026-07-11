import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary Resolve",
	slug: "book.openlibrary.resolve",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
