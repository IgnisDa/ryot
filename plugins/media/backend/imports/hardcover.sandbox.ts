import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptHardcoverCsv } from "./hardcover";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.hardcover",
	name: "Parse Hardcover import",
});

export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("hardcover", input, (text) => adaptHardcoverCsv(text, input.importedAt)).pipe(
			Effect.map((output) => ({ output })),
		),
});
