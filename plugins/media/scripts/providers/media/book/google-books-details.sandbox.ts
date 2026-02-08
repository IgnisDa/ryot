import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./google-books";

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books Details",
	slug: "book.google-books.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["googleBooksApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
