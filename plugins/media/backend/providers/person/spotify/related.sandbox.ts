import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { related } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Person Related",
	slug: "person.spotify.related",
});

export default defineProvider({ manifest, run: related.run, operation: "related" });
