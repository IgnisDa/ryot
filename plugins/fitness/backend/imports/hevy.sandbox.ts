import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { FitnessStageInput, FitnessStageOutput } from "./schemas";
import { runFitnessStage } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.hevy",
	name: "Collect Hevy import",
});

export default defineActivity({
	manifest,
	input: FitnessStageInput,
	output: FitnessStageOutput,
	run: (input) => runFitnessStage("hevy", input).pipe(Effect.map((output) => ({ output }))),
});
