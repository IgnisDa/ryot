import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { trending } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "TMDB Movie Trending",
	slug: "movie.tmdb.trending",
});

export default defineActivity({
	manifest,
	run: trending.run,
	input: trending.input,
	output: trending.output,
});
