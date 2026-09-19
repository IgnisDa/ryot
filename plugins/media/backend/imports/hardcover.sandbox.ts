import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptHardcoverCsv } from "./hardcover";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.hardcover",
	name: "Parse Hardcover import",
	capabilities: ["artifact-read", "scratch"],
});

export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("hardcover", input, (text) => adaptHardcoverCsv(text, input.importedAt)),
});
