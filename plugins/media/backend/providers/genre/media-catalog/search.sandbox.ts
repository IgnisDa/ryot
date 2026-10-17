import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { genreSearch } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Media Genre Search",
	slug: "genre.media-catalog.search",
});

export default defineProvider({ manifest, run: genreSearch, operation: "search" });
