import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./myanimelist";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Search",
	slug: "anime.myanimelist.search",
	requiredAppConfigKeys: ["animeAndManga.malClientId"],
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
