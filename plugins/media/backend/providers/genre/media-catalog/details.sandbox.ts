import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { genreDetails } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Media Genre Details",
	slug: "genre.media-catalog.details",
});

export default defineProvider({ manifest, run: genreDetails, operation: "details" });
