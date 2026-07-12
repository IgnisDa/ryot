import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptMediaTrackerData } from "../../imports/media-tracker";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Fetch MediaTracker import",
	slug: "activity.import.media_tracker",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: UrlAndKeyImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		adaptMediaTrackerData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
