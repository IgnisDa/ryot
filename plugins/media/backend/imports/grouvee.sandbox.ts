import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptGrouveeCsv } from "./grouvee";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.grouvee",
	name: "Parse Grouvee import",
});

export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("grouvee", input, (text, eventOffset) =>
			adaptGrouveeCsv(text, input.importedAt, eventOffset, 128),
		),
});
