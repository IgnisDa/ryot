import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import { resolveEpisodes } from "../../operations/resolve-episodes";
import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../operations/schemas";

export const manifest = defineManifest({
	kind: "operation",
	name: "Resolve Episodes",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql"],
	slug: "operation.resolve-episodes",
});

export default defineOperation({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeRyotql).pipe(Effect.map((results) => ({ results }))),
});
