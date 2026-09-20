import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { trending } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "TMDB Movie Trending",
	slug: "movie.tmdb.trending",
});

export default defineScript({
	manifest,
	run: trending.run,
	input: trending.input,
	output: trending.output,
});
