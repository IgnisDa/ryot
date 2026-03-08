import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { readArtifact } from "@ryot/sandbox-sdk/filesystem";

import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { adaptWatcharrExportBatch } from "../../imports/watcharr";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.watcharr",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Parse Watcharr import",
	capabilities: ["artifact-read"],
});

const decoder = new TextDecoder();

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readArtifact().pipe(
			Effect.map(decoder.decode.bind(decoder)),
			Effect.map((text) => adaptWatcharrExportBatch(text, input.start, input.limit)),
		),
});
