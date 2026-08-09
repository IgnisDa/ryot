import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../contracts/operations";
import { resolveEpisodes } from "../operations/resolve-episodes";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "import.resolve-episodes",
	capabilities: ["executeRyotql"],
	name: "Resolve imported episodes",
});

export default defineScript({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeRyotql).pipe(Effect.map((results) => ({ results }))),
});
