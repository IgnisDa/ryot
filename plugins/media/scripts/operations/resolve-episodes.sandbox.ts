import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import { resolveEpisodes } from "../../operations/resolve-episodes";
import { ResolveEpisodesInput, ResolveEpisodesOutput } from "../../operations/schemas";

export const manifest = defineManifest({
	kind: "operation",
	name: "Resolve Episodes",
	requiredAppConfigKeys: [],
	slug: "operation.resolve-episodes",
	capabilities: ["executeQueryEngine"],
});

export default defineOperation({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeQueryEngine).pipe(
			Effect.map((results) => ({ results })),
		),
});
