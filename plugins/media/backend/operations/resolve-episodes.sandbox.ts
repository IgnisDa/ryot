import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../contracts/operations";
import { resolveEpisodes } from "./resolve-episodes";

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
