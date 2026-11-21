import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { parseCsvText } from "./csv";
import { adaptGoodreadsCsv } from "./goodreads";
import { normalizeReadCount } from "./helpers";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.goodreads",
	name: "Parse Goodreads import",
});

export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("goodreads", input, (text, eventOffset) => ({
			...adaptGoodreadsCsv(text, input.importedAt, eventOffset, 128),
			nextEventOffset:
				eventOffset + 128 < normalizeReadCount(parseCsvText(text).rows[0]?.["Read Count"] ?? "")
					? eventOffset + 128
					: 0,
		})),
});
