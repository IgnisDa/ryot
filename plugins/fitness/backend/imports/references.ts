import {
	defineExecutableAlternatives,
	defineScriptReference,
} from "@ryot-app/sandbox-sdk/workflow";

import { FitnessStageInput, FitnessStageResult } from "./schemas";

const scriptReference = <const Slug extends string>(scriptSlug: Slug) =>
	defineScriptReference({ scriptSlug, input: FitnessStageInput, output: FitnessStageResult });

export const fitnessParsers = defineExecutableAlternatives({
	stage: "settings",
	id: "source-parser",
	references: {
		"import.hevy": scriptReference("import.hevy"),
		"import.open-scale": scriptReference("import.open-scale"),
		"import.strong-app": scriptReference("import.strong-app"),
	},
});
