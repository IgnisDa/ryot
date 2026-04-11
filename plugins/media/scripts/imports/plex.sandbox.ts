import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptPlexData } from "../../imports/plex";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Fetch Plex import",
	slug: "activity.import.plex",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: UrlAndKeyImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		adaptPlexData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
