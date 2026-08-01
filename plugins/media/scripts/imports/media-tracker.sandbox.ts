import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptMediaTrackerData } from "../../imports/media-tracker";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	slug: "import.media_tracker",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fetch MediaTracker import",
});

export default defineScript({
	manifest,
	output: MediaImportAdapterBatch,
	input: UrlAndKeyImportParserInput,
	run: (input, host) =>
		adaptMediaTrackerData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
