import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { MediaReviewDeleteInput, MediaReviewOutput } from "../../shared/media-review-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { deleteTargetChanges, loadEditTargets, reviewCombinations } from "./media-activity-edits";

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
			const targets = yield* loadEditTargets(
				host,
				[input.eventId],
				reviewCombinations,
				catalogMessage("rejection.record.review-only-delete"),
			);
			const output = { count: targets.length };
			return targets.length === 0 ? { output } : { output, changes: deleteTargetChanges(targets) };
		}),
});
