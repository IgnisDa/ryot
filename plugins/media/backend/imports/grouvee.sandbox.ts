import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptGrouveeCsv } from "./grouvee";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.grouvee",
	name: "Parse Grouvee import",
});

export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("grouvee", input, (text, eventOffset) =>
			adaptGrouveeCsv(text, input.importedAt, eventOffset, 128),
		).pipe(Effect.map((output) => ({ output }))),
});
