import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz Music Group Details",
	slug: "music-group.music-brainz.details",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
