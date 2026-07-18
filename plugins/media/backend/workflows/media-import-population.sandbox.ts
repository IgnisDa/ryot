import { LifecycleCommand } from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

import {
	KernelEntityImportResult,
	MediaImportPopulationWorkflowInput,
	MediaImportPopulationWorkflowOutput,
} from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media import population",
	slug: "workflow.media-import-population",
});

const entityImport = {
	output: KernelEntityImportResult,
	workflowSlug: "kernel:entity-import",
	input: Schema.Union([
		Schema.Struct({
			command: LifecycleCommand,
			externalId: Schema.String,
			providerId: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
		Schema.Struct({
			command: LifecycleCommand,
			externalId: Schema.String,
			providerSlug: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
	]),
};

const ITEM_CONCURRENCY = 4;

export default defineWorkflow({
	manifest,
	input: MediaImportPopulationWorkflowInput,
	output: MediaImportPopulationWorkflowOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const childResults = yield* Effect.all(
				input.items.map((item) =>
					replay.child(`import-${item.index}`, entityImport, {
						command: item.command,
						externalId: item.externalId,
						entitySchemaSlug: item.entitySchemaSlug,
						...("providerId" in item
							? { providerId: item.providerId }
							: { providerSlug: item.providerSlug }),
					}),
				),
				{ concurrency: ITEM_CONCURRENCY },
			);
			const results: Array<(typeof MediaImportPopulationWorkflowOutput.Type)["results"][number]> =
				input.items.map((item, index) => {
					const result = childResults[index];
					if (result === undefined) {
						throw new Error("Population results are out of sync");
					}
					return result.status === "completed"
						? { index: item.index, status: "completed", entityId: result.entity.id }
						: { status: "failed", index: item.index, stage: result.stage, message: result.message };
				});
			return { results };
		}),
});
