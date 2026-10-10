import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "podcast.listennotes.search",
	name: "Listen Notes Podcast Search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
