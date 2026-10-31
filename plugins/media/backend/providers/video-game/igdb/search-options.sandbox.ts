import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { searchOptions } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Search Options",
	slug: "video-game.igdb.search-options",
});

export default defineProvider({ manifest, run: searchOptions.run, operation: "search-options" });
