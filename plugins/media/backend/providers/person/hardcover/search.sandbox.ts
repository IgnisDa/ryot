import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "Hardcover Person Search",
	slug: "person.hardcover.search",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
