import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { genreResolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Media Genre Resolve",
	slug: "genre.media-catalog.resolve",
});

export default defineProvider({ manifest, run: genreResolve, operation: "resolve" });
