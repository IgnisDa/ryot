import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./giant-bomb";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Video Game Details",
	slug: "video-game.giant-bomb.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
