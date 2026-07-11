import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	MediaImportResolveEpisodesInput,
	MediaImportResolveEpisodesOutput,
} from "../../imports/schemas";
import { resolveEpisodes } from "../../operations/resolve-episodes";

export const manifest = defineManifest({
	kind: "activity",
	name: "Resolve imported episodes",
	requiredAppConfigKeys: [],
	capabilities: ["executeQueryEngine"],
	slug: "activity.import.resolve-episodes",
});

export default defineActivity({
	manifest,
	input: MediaImportResolveEpisodesInput,
	output: MediaImportResolveEpisodesOutput,
	run: (input, host) =>
		resolveEpisodes(input.refs, host.executeQueryEngine).pipe(
			Effect.map((results) => ({ results })),
		),
});
