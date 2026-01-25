import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { adaptStorygraphCsv } from "../../imports/storygraph";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse StoryGraph import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.storygraph",
	capabilities: ["artifact-read"],
});
export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) =>
				batchMediaImportResult(adaptStorygraphCsv(text), input.start, input.limit),
			),
		),
});
