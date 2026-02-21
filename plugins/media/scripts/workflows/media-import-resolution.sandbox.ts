import { defineManifest, defineWorkflow, Effect } from "@ryot/sandbox-sdk/workflow";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
	MediaImportResolutionWorkflowInput,
	MediaImportResolutionWorkflowOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Media import resolution",
	slug: "workflow.media-import-resolution",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: MediaImportResolutionWorkflowInput,
	output: MediaImportResolutionWorkflowOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			const results: Array<(typeof MediaImportResolutionWorkflowOutput.Type)["results"][number]> =
				[];
			for (const item of input.items) {
				const errors: string[] = [];
				let resolved: { externalId: string; providerSlug: string } | null = null;
				for (const [candidateIndex, candidate] of item.candidates.entries()) {
					const result = yield* replay.activity(
						`resolve-${item.index}-${candidateIndex}`,
						{
							input: MediaImportResolutionActivityInput,
							output: MediaImportResolutionActivityResult,
							scriptSlug: candidate.scriptSlug,
						},
						{ value: item.value, identifierType: item.identifierType },
					);
					if (result.status === "failed") {
						errors.push(`${candidate.providerSlug}: ${result.message}`);
						continue;
					}
					if (result.externalId) {
						resolved = { externalId: result.externalId, providerSlug: candidate.providerSlug };
						break;
					}
				}
				results.push(
					resolved
						? { index: item.index, status: "resolved", ...resolved }
						: { index: item.index, status: "unresolved", errors },
				);
			}
			return { results };
		}),
});
