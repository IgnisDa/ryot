import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./google-books";

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books Resolve",
	requiredSystemConfigKeys: [],
	slug: "book.google-books.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["googleBooksApiKey"],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
