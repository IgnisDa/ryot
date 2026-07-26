import {
	genericImportKernelInputSchema,
	genericImportWorkflowManifestSchema,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Fitness import",
	slug: "workflow.import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const scriptReference = (scriptSlug: string) => ({
	scriptSlug,
	input: Schema.Struct({}),
	output: genericImportWorkflowManifestSchema,
});

const kernelImport = {
	input: genericImportKernelInputSchema,
	output: genericImportWorkflowResultSchema,
	workflowSlug: "kernel:process-import-chunks",
};

export default defineWorkflow({
	manifest,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, replay) =>
		Effect.gen(function* () {
			let scriptSlug = "import.open-scale";
			if (input.source === "hevy") {
				scriptSlug = "import.hevy";
			}
			if (input.source === "strong_app") {
				scriptSlug = "import.strong-app";
			}
			const adapterManifest = yield* replay.activity(
				"parse-artifact",
				scriptReference(scriptSlug),
				{},
			);
			return yield* replay.child("write-import", kernelImport, {
				runId: input.runId,
				...adapterManifest,
			});
		}),
});
