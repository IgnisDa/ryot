import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./google-books";

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books Resolve",
	slug: "book.google-books.resolve",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["googleBooksApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
