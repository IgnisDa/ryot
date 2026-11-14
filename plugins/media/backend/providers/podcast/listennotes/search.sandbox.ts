import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "podcast.listennotes.search",
	name: "Listen Notes Podcast Search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
