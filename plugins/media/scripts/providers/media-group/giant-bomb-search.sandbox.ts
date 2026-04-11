import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./giant-bomb";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Video Game Group Search",
	slug: "video-game-group.giant-bomb.search",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
