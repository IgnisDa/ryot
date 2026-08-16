import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { genericImportAdapterManifestSchema } from "@ryot/sandbox-sdk/imports";

import { adaptHevyCsv } from "../../import-adapters/hevy";
import { readImportArtifactText, writeImportChunks } from "./shared";
import { toWorkoutWriteItem } from "./workout";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.hevy",
	name: "Parse Hevy import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: ["timezone"],
	capabilities: ["artifact-read", "scratch", "getSystemConfig"],
});

export default defineScript({
	manifest,
	input: Schema.Struct({}),
	output: genericImportAdapterManifestSchema,
	run: (_input, host) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText();
			const timezone = yield* host
				.getSystemConfig(["timezone"])
				.pipe(Effect.map(({ timezone: timezoneValue }) => timezoneValue))
				.pipe(Effect.catch(() => Effect.succeed("Etc/GMT")));
			const result = adaptHevyCsv(text, typeof timezone === "string" ? timezone : "UTC");
			return yield* writeImportChunks(result.failures, result.items.map(toWorkoutWriteItem));
		}),
});
