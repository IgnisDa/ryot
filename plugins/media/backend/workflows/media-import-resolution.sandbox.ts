import {
	defineExecutableAlternatives,
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
	MediaImportResolutionWorkflowInput,
	MediaImportResolutionWorkflowOutput,
} from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Media import resolution",
	slug: "workflow.media-import-resolution",
});

const reference = <const Slug extends string>(scriptSlug: Slug) =>
	defineScriptReference({
		scriptSlug,
		input: MediaImportResolutionActivityInput,
		output: MediaImportResolutionActivityResult,
	});
const candidates = defineExecutableAlternatives({
	stage: "record",
	id: "record-resolution",
	references: {
		"media-import-resolve.show.tmdb": reference("media-import-resolve.show.tmdb"),
		"media-import-resolve.movie.tmdb": reference("media-import-resolve.movie.tmdb"),
		"media-import-resolve.book.hardcover": reference("media-import-resolve.book.hardcover"),
		"media-import-resolve.book.openlibrary": reference("media-import-resolve.book.openlibrary"),
		"media-import-resolve.book.google-books": reference("media-import-resolve.book.google-books"),
	},
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
						selectExecutable(candidates, candidate.scriptSlug),
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
