import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../shared/integration-operations";
import { resolveEpisodes } from "../operations/resolve-episodes";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.resolve-episodes",
	name: "Resolve imported episodes",
});

export default defineActivity({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeRyotql).pipe(
			Effect.map((results) => ({ results })),
			Effect.map((output) => ({ output })),
		),
});
