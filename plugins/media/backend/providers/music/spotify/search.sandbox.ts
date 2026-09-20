import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Search",
	slug: "music.spotify.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
