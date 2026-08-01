import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./manga-updates";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates Details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "manga.manga-updates.details",
});

export default defineProvider({ manifest, operation: "details", run: details.run });
