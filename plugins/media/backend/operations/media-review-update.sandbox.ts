import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { reviewProperties, reviewPropertyKeys } from "@ryot-app/plugin-kit/schema";

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
				return yield* new OperationRejectedError({ message: "This review no longer exists." });
			}
			yield* requireDeclaredProperties(
				target,
				mediaReviewDeclaredProperties(target.entitySchemaSlug),
			);
			const set = reviewProperties(input);
			return yield* host
				.updateEvents([
					{
						eventId: target.id,
						expected: writePrecondition(input.expected),
						patch: {
							properties: { set, remove: reviewPropertyKeys.filter((key) => !(key in set)) },
						},
					},
				])
				.pipe(Effect.catch(rejectHostFailure));
		}),
});
