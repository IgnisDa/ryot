import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { reviewPropertiesPatch } from "@ryot-app/plugin-kit/schema";

import { mediaReviewDeclaredProperties } from "../../shared/media-activity-fields";
import {
	MediaReviewOutput,
	MediaReviewUpdateInput,
	reviewPositionError,
} from "../../shared/media-review-operations";
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
			const { position } = input;
			const positionError = reviewPositionError(target.entitySchemaSlug, position);
			if (positionError !== undefined) {
				return yield* new OperationRejectedError({ message: positionError });
			}
			const { set, remove } = reviewPropertiesPatch(input);
			return yield* host
				.updateEvents([
					{
						eventId: target.id,
						expected: writePrecondition(input.expected),
						patch: {
							properties: {
								set: position ? { ...set, position } : set,
								remove: position === null ? [...remove, "position"] : remove,
							},
						},
					},
				])
				.pipe(Effect.catch(rejectHostFailure));
		}),
});
