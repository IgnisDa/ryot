import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptImdbCsv } from "../../imports/imdb";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse IMDb import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.imdb",
	capabilities: ["artifact-read"],
});
export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) => batchMediaImportResult(adaptImdbCsv(text), input.start, input.limit)),
		),
});
