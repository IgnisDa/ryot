import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Search",
	slug: "anime.myanimelist.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
