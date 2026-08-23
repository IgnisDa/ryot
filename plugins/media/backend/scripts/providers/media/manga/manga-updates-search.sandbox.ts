import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./manga-updates";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates Search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
	slug: "manga.manga-updates.search",
});

export default defineProvider({ manifest, operation: "search", run: search.run });
