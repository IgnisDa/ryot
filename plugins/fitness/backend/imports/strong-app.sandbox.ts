import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { FitnessStageInput, FitnessStageOutput } from "./schemas";
import { runFitnessStage } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.strong-app",
	name: "Collect Strong import",
});

export default defineActivity({
	manifest,
	input: FitnessStageInput,
	output: FitnessStageOutput,
	run: (input) => runFitnessStage("strong_app", input).pipe(Effect.map((output) => ({ output }))),
});
