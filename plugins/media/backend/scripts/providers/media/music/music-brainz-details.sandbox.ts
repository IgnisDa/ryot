import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz Music Details",
	slug: "music.music-brainz.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
