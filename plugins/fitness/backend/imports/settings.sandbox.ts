import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";

import { FitnessSettingsInput, FitnessSettingsOutput } from "./settings";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.settings",
	capabilities: ["artifact-read"],
	name: "Read admitted Fitness settings",
});

export default defineScript({
	manifest,
	input: FitnessSettingsInput,
	output: FitnessSettingsOutput,
	run: (input) =>
		Effect.gen(function* () {
			const range = yield* readArtifactRange(0, 16384);
			if (range.size > 16384) {
				throw new Error("Fitness admitted settings exceed 16 KiB");
			}
			const settings = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Record(Schema.String, jsonValueSchema)),
			)(new TextDecoder("utf-8", { fatal: true }).decode(range.bytes));
			const timezone = settings["timezone"];
			if (input.source !== "open_scale" && (typeof timezone !== "string" || !timezone.trim())) {
				throw new Error("Import job is missing timezone");
			}
			return { timezone: typeof timezone === "string" ? timezone.trim() : "" };
		}),
});
