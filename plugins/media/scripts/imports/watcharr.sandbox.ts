import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { readArtifact } from "@ryot/sandbox-sdk/filesystem";

import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { adaptWatcharrExportBatch } from "../../imports/watcharr";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse Watcharr import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.watcharr",
	capabilities: ["artifact-read"],
});

const decoder = new TextDecoder();

export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readArtifact().pipe(
			Effect.map(decoder.decode.bind(decoder)),
			Effect.map((text) => adaptWatcharrExportBatch(text, input.start, input.limit)),
		),
});
