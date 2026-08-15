import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	name: "Anilist Search",
	kind: "provider",
	slug: "manga.anilist.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
