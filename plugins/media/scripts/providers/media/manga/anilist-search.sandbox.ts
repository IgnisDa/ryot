import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./anilist";

export const manifest = defineManifest({
	name: "Anilist Search",
	kind: "provider",
	slug: "manga.anilist.search",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
