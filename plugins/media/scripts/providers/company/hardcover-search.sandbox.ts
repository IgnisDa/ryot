import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Company Search",
	slug: "company.hardcover.search",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
