import {
	genericImportAdapterManifestSchema,
	genericImportKernelInputSchema,
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

const activityReference = (scriptSlug: string) => ({
	scriptSlug,
	input: Schema.Struct({}),
	output: genericImportAdapterManifestSchema,
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
			let scriptSlug = "activity.import.open-scale";
			if (input.source === "hevy") {
				scriptSlug = "activity.import.hevy";
			}
			if (input.source === "strong_app") {
				scriptSlug = "activity.import.strong-app";
			}
			const adapterManifest = yield* replay.activity(
				"parse-artifact",
				activityReference(scriptSlug),
				{},
			);
			return yield* replay.child("write-import", kernelImport, {
				runId: input.runId,
				...adapterManifest,
			});
		}),
});
