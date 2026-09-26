import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Details",
	requiredPluginConfigKeys: [],
	slug: "anime.anilist.details",
	capabilities: ["httpCall", "getUserSettings"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
