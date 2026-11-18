import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaJson } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptWatcharrExportBatch } from "./watcharr";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.watcharr",
	name: "Collect Watcharr export",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaJson("watcharr", input, (rows, eventOffset) =>
			adaptWatcharrExportBatch(rows, 0, rows.length, input.importedAt, eventOffset, 128),
		).pipe(Effect.map((output) => ({ output }))),
});
