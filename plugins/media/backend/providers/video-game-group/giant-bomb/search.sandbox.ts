import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Video Game Group Search",
	slug: "video-game-group.giant-bomb.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
