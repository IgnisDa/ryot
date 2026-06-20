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
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			passRawQuery: {
				type: "boolean",
				label: "Pass raw query",
				description: "Pass the query to Google Books without adding a title qualifier",
			},
		},
	},
});

export default defineProvider({ manifest, operation: "search", run: search.run });
