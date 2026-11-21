import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { parseCsvText } from "./csv";
import { normalizeReadCount } from "./helpers";
import { adaptStorygraphCsv } from "./storygraph";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.storygraph",
	name: "Parse StoryGraph import",
});

export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("storygraph", input, (text, eventOffset) => ({
			...adaptStorygraphCsv(text, input.importedAt, eventOffset, 128),
			nextEventOffset:
				eventOffset + 128 < normalizeReadCount(parseCsvText(text).rows[0]?.["Read Count"] ?? "")
					? eventOffset + 128
					: 0,
		})),
});
