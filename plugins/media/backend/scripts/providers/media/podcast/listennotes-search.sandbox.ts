import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./listennotes";

export const manifest = defineManifest({
	kind: "provider",
	name: "Listen Notes Podcast Search",
	slug: "podcast.listennotes.search",
	requiredPluginConfigKeys: ["listennotesApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
