import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./giant-bomb";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Video Game Details",
	slug: "video-game.giant-bomb.details",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
