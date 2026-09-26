import { defineManifest, defineWorkflow, Effect } from "@ryot-app/sandbox-sdk/workflow";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
	MediaImportResolutionWorkflowInput,
	MediaImportResolutionWorkflowOutput,
} from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media import resolution",
	slug: "workflow.media-import-resolution",
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
							scriptSlug: candidate.scriptSlug,
							input: MediaImportResolutionActivityInput,
							output: MediaImportResolutionActivityResult,
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
						: { errors, index: item.index, status: "unresolved" },
				);
			}
			return { results };
		}),
});
