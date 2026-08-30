import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books Resolve",
	requiredSystemConfigKeys: [],
	slug: "book.google-books.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["googleBooksApiKey"],
});

export default defineProvider({ manifest, run: resolve.run, operation: "resolve" });
