import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./listennotes";

export const manifest = defineManifest({
	kind: "provider",
	name: "Listen Notes Podcast Details",
	slug: "podcast.listennotes.details",
	requiredPluginConfigKeys: ["listennotesApiKey"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
