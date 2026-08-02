import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "MusicBrainz Music Group Search",
	slug: "music-group.music-brainz.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
