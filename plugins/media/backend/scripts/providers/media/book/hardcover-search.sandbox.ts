import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Search",
	requiredSystemConfigKeys: [],
	slug: "book.hardcover.search",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
