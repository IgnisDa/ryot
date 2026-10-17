import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Group Details",
	slug: "video-game-group.igdb.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
