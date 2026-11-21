import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptImdbCsv } from "./imdb";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.imdb",
	name: "Parse IMDb import",
});

export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) => collectMediaCsv("imdb", input, (text) => adaptImdbCsv(text, input.importedAt)),
});
