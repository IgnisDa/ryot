import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { FitnessStageInput, FitnessStageOutput } from "./schemas";
import { runFitnessStage } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.strong-app",
	name: "Collect Strong import",
});

export default defineScript({
	manifest,
	input: FitnessStageInput,
	output: FitnessStageOutput,
	run: (input) => runFitnessStage("strong_app", input),
});
