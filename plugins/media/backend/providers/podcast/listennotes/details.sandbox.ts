import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	slug: "podcast.listennotes.details",
	name: "Listen Notes Podcast Details",
	requiredPluginConfigKeys: ["listennotesApiKey"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
