import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../contracts/operations";
import { resolveEpisodes } from "../operations/resolve-episodes";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.resolve-episodes",
	name: "Resolve imported episodes",
});

export default defineScript({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeRyotql).pipe(Effect.map((results) => ({ results }))),
});
