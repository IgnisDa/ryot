import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./google-books";

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books Search",
	requiredSystemConfigKeys: [],
	slug: "book.google-books.search",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["googleBooksApiKey"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
