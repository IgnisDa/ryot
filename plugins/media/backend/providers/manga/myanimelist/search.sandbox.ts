import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Search",
	slug: "manga.myanimelist.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
