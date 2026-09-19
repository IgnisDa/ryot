import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { parseCsvText } from "./csv";
import { normalizeReadCount } from "./helpers";
import { adaptStorygraphCsv } from "./storygraph";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.storygraph",
	name: "Parse StoryGraph import",
	capabilities: ["artifact-read", "scratch"],
});

export default defineScript({
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
