import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "MangaUpdates Details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "manga.manga-updates.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
