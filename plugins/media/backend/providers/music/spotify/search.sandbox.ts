import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Search",
	slug: "music.spotify.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
