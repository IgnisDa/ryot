import {
	genericImportKernelInputSchema,
	genericImportWorkflowManifestSchema,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Fitness import",
	slug: "workflow.import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export class FitnessWorkflowError extends Error {
	readonly _tag = "FitnessWorkflowError";
}

const scriptReference = (scriptSlug: string) => ({
	scriptSlug,
	output: genericImportWorkflowManifestSchema,
	input: Schema.Struct({ timezone: Schema.optional(Schema.String) }),
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
			let parserInput: { timezone?: string } = {};
			if (input.source === "hevy" || input.source === "strong_app") {
				scriptSlug = input.source === "hevy" ? "import.hevy" : "import.strong-app";
				const timezone = input.sourcePayload?.["timezone"];
				if (typeof timezone !== "string" || !timezone.trim()) {
					return yield* Effect.fail(new FitnessWorkflowError("Import job is missing timezone"));
				}
				parserInput = { timezone: timezone.trim() };
			}
			const adapterManifest = yield* replay.activity(
				"parse-artifact",
				scriptReference(scriptSlug),
				parserInput,
			);
			return yield* replay.child("write-import", kernelImport, {
				runId: input.runId,
				command: input.command,
				...adapterManifest,
			});
		}),
});
