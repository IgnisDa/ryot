import { defineActivityWithChanges, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { trending } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "TMDB Show Trending",
	slug: "show.tmdb.trending",
});

export default defineActivityWithChanges({
	manifest,
	run: trending.run,
	input: trending.input,
	output: trending.output,
});
