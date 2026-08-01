import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptPlexData } from "../../imports/plex";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.plex",
	name: "Fetch Plex import",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	output: MediaImportAdapterBatch,
	input: UrlAndKeyImportParserInput,
	run: (input, host) =>
		adaptPlexData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
