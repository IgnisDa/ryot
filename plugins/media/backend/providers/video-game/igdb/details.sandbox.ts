import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Details",
	slug: "video-game.igdb.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
