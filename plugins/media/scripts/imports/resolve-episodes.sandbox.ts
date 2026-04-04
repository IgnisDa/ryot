import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { resolveEpisodes } from "../../operations/resolve-episodes";
import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../operations/schemas";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "import.resolve-episodes",
	name: "Resolve imported episodes",
	capabilities: ["executeQueryEngine"],
});

export default defineScript({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeQueryEngine).pipe(
			Effect.map((results) => ({ results })),
		),
});
