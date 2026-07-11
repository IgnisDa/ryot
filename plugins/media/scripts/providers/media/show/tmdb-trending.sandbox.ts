import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";

import { trending } from "./tmdb";

export const manifest = defineManifest({
	kind: "script",
	name: "TMDB Show Trending",
	slug: "show.tmdb.trending",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	input: trending.input,
	output: trending.output,
	run: trending.run,
});
