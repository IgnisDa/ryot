import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./manga-updates";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates Person Search",
	slug: "person.manga-updates.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
