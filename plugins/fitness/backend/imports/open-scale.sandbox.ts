import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";

import { FitnessStageInput, FitnessStageOutput } from "./schemas";
import { runFitnessStage } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.open-scale",
	name: "Collect OpenScale import",
});

export default defineScript({
	manifest,
	input: FitnessStageInput,
	output: FitnessStageOutput,
	run: (input) => runFitnessStage("open_scale", input),
});
