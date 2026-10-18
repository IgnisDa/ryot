import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { MediaReviewDeleteInput, MediaReviewOutput } from "../../shared/media-review-operations";
import { loadEditTargets, rejectHostFailure, reviewCombinations } from "./media-activity-edits";

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete media review",
	slug: "operation.media-review-delete",
});

export default defineOperation({
	manifest,
	output: MediaReviewOutput,
	input: MediaReviewDeleteInput,
	run: (input, host) =>
		Effect.gen(function* () {
			yield* loadEditTargets(
				host,
				[input.eventId],
				reviewCombinations,
				"Only reviews can be deleted here.",
			);
			return yield* host
				.deleteEvents([input.eventId], {
					submittedAt: input.submittedAt,
					idempotencyKey: `${input.submissionId}:write`,
				})
				.pipe(Effect.catch(rejectHostFailure));
		}),
});
