import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { expect, it } from "vitest";

import { CompletionEpisode, CompletionOccurrence } from "../../shared/history-correction";
import { mediaHistoryCorrectionStatusRecipe } from "../../shared/history-correction-status";
import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	correctionCoverageRecipe,
	correctionInventoryRecipe,
	correctionRecordsRecipe,
	coverageBasisRecipe,
	historyCorrectionContextRecipe,
	historyRecordRecipe,
	historySourceRecipe,
	progressCompletionBlockersRecipe,
} from "./history-correction-recipes";

const input = {
	cycle: 0,
	runKey: "run",
	libraryId: "library",
	sourceEventId: "source",
	subjectEntityId: "subject",
};

it("keeps correction reads executable for fresh and retained evidence", () => {
	const recipes = [
		historyCorrectionContextRecipe({ entityId: "subject", libraryId: "library" }),
		historyRecordRecipe({ occurrenceId: "occurrence" }),
		coverageBasisRecipe(input),
		mediaHistoryCorrectionStatusRecipe({ entityId: "subject", reference: { kind: "self" } }),
		correctionRecordsRecipe(CompletionOccurrence, { ...input, slug: "completion-occurrence" }),
		correctionRecordsRecipe(CompletionEpisode, { ...input, slug: "completion-episode" }),
		...[true, false].flatMap((positional) => [
			historySourceRecipe({ entityId: "subject", progressOnly: positional }),
			progressCompletionBlockersRecipe({
				...input,
				positional,
				source: {
					revision: 0,
					id: "source",
					orderKey: "source",
					entityId: "subject",
					sessionEntityId: null,
					entitySchemaSlug: "movie",
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100 },
					createdAt: "2026-01-01T00:00:00.000Z",
					occurredAt: "2026-01-01T00:00:00.000Z",
					orderCreatedAt: "2026-01-01T00:00:00.000Z",
				},
			}),
		]),
		...[showEpisodicKindConfig, podcastEpisodicKindConfig].flatMap((config) =>
			[undefined, "occurrence"].flatMap((basisId) => [
				correctionCoverageRecipe({ ...input, config, basisId }),
				correctionInventoryRecipe({ ...input, config, basisId }),
			]),
		),
	];
	for (const recipe of recipes) {
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess).error).toBeNull();
	}
});
