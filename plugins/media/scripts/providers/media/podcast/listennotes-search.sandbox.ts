import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./listennotes";

export const manifest = defineManifest({
	kind: "provider",
	name: "Listen Notes Podcast Search",
	slug: "podcast.listennotes.search",
	requiredAppConfigKeys: ["podcasts.listennotesApiKey"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
