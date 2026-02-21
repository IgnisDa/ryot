import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { resolveEpisodes } from "../../operations/resolve-episodes";
import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../operations/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Resolve imported episodes",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeQueryEngine"],
	slug: "activity.import.resolve-episodes",
});

export default defineActivity({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeQueryEngine).pipe(
			Effect.map((results) => ({ results })),
		),
});
