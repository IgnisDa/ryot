import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportAdapterManifestSchema } from "@ryot-app/sandbox-sdk/imports";

import { adaptHevyCsv } from "./hevy";
import { readImportArtifactText, writeImportChunks } from "./shared";
import { toWorkoutWriteItem } from "./workout";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.hevy",
	name: "Parse Hevy import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["artifact-read", "scratch"],
});

export default defineScript({
	manifest,
	output: genericImportAdapterManifestSchema,
	input: Schema.Struct({ timezone: Schema.String }),
	run: (input) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText;
			const result = adaptHevyCsv(text, input.timezone);
			return yield* writeImportChunks(result.failures, result.items.map(toWorkoutWriteItem));
		}),
});
