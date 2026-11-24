import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaJson } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptMediaHistoryBatch } from "./media-history";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.media-history",
	name: "Collect Media history JSON",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaJson("media-history", input, (rows, eventOffset) =>
			adaptMediaHistoryBatch(rows, eventOffset, 128),
		),
});
