import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { genericImportAdapterManifestSchema } from "@ryot/sandbox-sdk/imports";

import { adaptStrongAppCsv } from "../../import-adapters/strong-app";
import { readImportArtifactText, writeImportChunks } from "./shared";
import { toWorkoutWriteItem } from "./workout";

export const manifest = defineManifest({
	kind: "activity",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: ["timezone"],
	name: "Parse Strong import",
	slug: "activity.import.strong-app",
	capabilities: ["artifact-read", "scratch", "getSystemConfigValue"],
});

export default defineActivity({
	manifest,
	input: Schema.Struct({}),
	output: genericImportAdapterManifestSchema,
	run: (_input, host) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText();
			const timezone = yield* host
				.getSystemConfigValue("timezone")
				.pipe(Effect.catchAll(() => Effect.succeed("Etc/GMT")));
			const result = adaptStrongAppCsv(text, typeof timezone === "string" ? timezone : "UTC");
			return yield* writeImportChunks(result.failures, result.items.map(toWorkoutWriteItem));
		}),
});
