import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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
		Schema.decodeUnknownEffect(Schema.String)(input.settings["collection"]).pipe(
			Effect.orDie,
			Effect.flatMap((collection) =>
				collectMediaCsv("igdb", input, (text) => adaptIgdbCsv(text, { collection })),
			),
		),
});
