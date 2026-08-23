import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "MangaUpdates Search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "manga.manga-updates.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
