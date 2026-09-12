import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaJson } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptWatcharrExportBatch } from "./watcharr";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.watcharr",
	name: "Collect Watcharr export",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaJson("watcharr", input, (rows, eventOffset) =>
			adaptWatcharrExportBatch(
				JSON.stringify(rows),
				0,
				rows.length,
				input.importedAt,
				eventOffset,
				128,
			),
		),
});
