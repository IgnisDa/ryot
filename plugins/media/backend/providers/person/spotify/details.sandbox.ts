import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Person Details",
	slug: "person.spotify.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
