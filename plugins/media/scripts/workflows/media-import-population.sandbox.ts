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
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const libraryEntityImport = {
	output: KernelLibraryEntityImportResult,
	workflowSlug: "kernel:library-entity-import",
	input: Schema.Union(
		Schema.Struct({
			origin: Schema.Unknown,
			externalId: Schema.String,
			providerId: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
		Schema.Struct({
			origin: Schema.Unknown,
			externalId: Schema.String,
			providerSlug: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
	),
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
					externalId: item.externalId,
					entitySchemaSlug: item.entitySchemaSlug,
					...("providerId" in item
						? { providerId: item.providerId }
						: { providerSlug: item.providerSlug }),
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
