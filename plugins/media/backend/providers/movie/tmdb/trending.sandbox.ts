import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { trending } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "TMDB Movie Trending",
	slug: "movie.tmdb.trending",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	input: trending.input,
	output: trending.output,
	run: trending.run,
});
