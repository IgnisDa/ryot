import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz Music Group Search",
	slug: "music-group.music-brainz.search",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
