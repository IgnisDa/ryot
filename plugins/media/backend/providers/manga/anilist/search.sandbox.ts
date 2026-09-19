import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Search",
	slug: "manga.anilist.search",
	capabilities: ["httpCall", "getUserSettings"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
