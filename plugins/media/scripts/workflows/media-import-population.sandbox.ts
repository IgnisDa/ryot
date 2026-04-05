import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

import {
	KernelLibraryEntityImportResult,
	MediaImportPopulationWorkflowInput,
	MediaImportPopulationWorkflowOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Media import population",
	slug: "workflow.media-import-population",
	requiredAppConfigKeys: [],
});

const libraryEntityImport = {
	input: Schema.Struct({
		userId: Schema.String,
		origin: Schema.Unknown,
		externalId: Schema.String,
		providerId: Schema.String,
		entitySchemaSlug: Schema.String,
	}),
	output: KernelLibraryEntityImportResult,
	workflowSlug: "kernel:library-entity-import",
};

export default defineWorkflow({
	manifest,
	input: MediaImportPopulationWorkflowInput,
	output: MediaImportPopulationWorkflowOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const results: Array<(typeof MediaImportPopulationWorkflowOutput.Type)["results"][number]> =
				[];
			for (const item of input.items) {
				const result = yield* replay.child(`import-${item.index}`, libraryEntityImport, {
					origin: item.origin,
					userId: item.userId,
					externalId: item.externalId,
					providerId: item.providerId,
					entitySchemaSlug: item.entitySchemaSlug,
				});
				results.push(
					result.status === "completed"
						? { index: item.index, status: "completed", entityId: result.entity.id }
						: { index: item.index, status: "failed", stage: result.stage, message: result.message },
				);
			}
			return { results };
		}),
});
