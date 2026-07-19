import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Resolve",
	requiredSystemConfigKeys: [],
	slug: "book.hardcover.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
