import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { adaptAudiobookshelfData } from "../../imports/audiobookshelf";
import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Fetch Audiobookshelf import",
	slug: "activity.import.audiobookshelf",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: UrlAndKeyImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		adaptAudiobookshelfData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
