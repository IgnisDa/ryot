import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { adaptGrouveeCsv } from "../../imports/grouvee";
import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse Grouvee import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.grouvee",
	capabilities: ["artifact-read"],
});
export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) => batchMediaImportResult(adaptGrouveeCsv(text), input.start, input.limit)),
		),
});
