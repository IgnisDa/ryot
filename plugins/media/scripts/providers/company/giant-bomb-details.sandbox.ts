import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./giant-bomb";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Company Details",
	slug: "company.giant-bomb.details",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
