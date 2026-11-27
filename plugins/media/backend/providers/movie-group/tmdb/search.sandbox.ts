import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Group Search",
	slug: "movie-group.tmdb.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
