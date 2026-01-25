import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptJellyfinData } from "../../imports/jellyfin";
import { JellyfinImportParserInput, MediaImportAdapterBatch } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Fetch Jellyfin import",
	slug: "activity.import.jellyfin",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: JellyfinImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		adaptJellyfinData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
