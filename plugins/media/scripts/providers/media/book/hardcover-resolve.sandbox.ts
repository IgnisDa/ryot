import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Resolve",
	slug: "book.hardcover.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
