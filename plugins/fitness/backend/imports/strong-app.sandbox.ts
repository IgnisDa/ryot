import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportAdapterManifestSchema } from "@ryot-app/sandbox-sdk/imports";

import { readImportArtifactText, writeImportChunks } from "./shared";
import { adaptStrongAppCsv } from "./strong-app";
import { toWorkoutWriteItem } from "./workout";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.strong-app",
	name: "Parse Strong import",
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
			const result = adaptStrongAppCsv(text, input.timezone);
			return yield* writeImportChunks(result.failures, result.items.map(toWorkoutWriteItem));
		}),
});
