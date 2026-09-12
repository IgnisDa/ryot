import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptIgdbCsv } from "./igdb";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.igdb",
	name: "Parse IGDB import",
});

export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv("igdb", input, (text) =>
			adaptIgdbCsv(text, {
				collection: Schema.decodeUnknownSync(Schema.String)(input.settings["collection"]),
			}),
		),
});
