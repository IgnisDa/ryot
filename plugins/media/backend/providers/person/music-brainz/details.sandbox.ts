import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz Person Details",
	slug: "person.music-brainz.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
