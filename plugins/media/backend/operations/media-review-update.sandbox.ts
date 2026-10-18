import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";

import { mediaReviewDeclaredProperties } from "../../shared/media-activity-fields";
import { MediaReviewOutput, MediaReviewUpdateInput } from "../../shared/media-review-operations";
import {
	loadEditTargets,
	rejectHostFailure,
	requireDeclaredProperties,
	reviewCombinations,
	writePrecondition,
} from "./media-activity-edits";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update media review",
	slug: "operation.media-review-update",
});

export default defineOperation({
	manifest,
	output: MediaReviewOutput,
	input: MediaReviewUpdateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [target] = yield* loadEditTargets(
				host,
				[input.eventId],
				reviewCombinations,
				"Only reviews can be edited here.",
			);
			if (target === undefined) {
				return yield* Effect.fail(new OperationRejectedError("This review no longer exists."));
			}
			yield* requireDeclaredProperties(
				target,
				mediaReviewDeclaredProperties(target.entitySchemaSlug),
			);
			const set = { text: input.text, isSpoiler: input.isSpoiler };
			return yield* host
				.updateEvents(
					[
						{
							eventId: target.id,
							expected: writePrecondition(input.expected),
							patch: {
								properties:
									input.rating === null
										? { set, remove: ["rating"] }
										: { remove: [], set: { ...set, rating: input.rating } },
							},
						},
					],
					{ submittedAt: input.submittedAt, idempotencyKey: `${input.submissionId}:write` },
				)
				.pipe(Effect.catch(rejectHostFailure));
		}),
});
