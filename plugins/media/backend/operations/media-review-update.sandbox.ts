import { expectedEventFields, updateEventChange } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EventId, reviewPropertiesPatch } from "@ryot-app/plugin-kit/schema";

import { mediaReviewDeclaredProperties } from "../../shared/media-activity-fields";
import {
	MediaReviewOutput,
	MediaReviewUpdateInput,
	reviewPositionError,
} from "../../shared/media-review-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { reject } from "../lib/failures";
import {
	loadEditTargets,
	requireDeclaredProperties,
	reviewCombinations,
} from "./media-activity-edits";
import { requireReviewConsumption } from "./media-review-consumption";

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
				catalogMessage("rejection.record.review-only-edit"),
			);
			if (target === undefined) {
				return yield* reject(catalogMessage("rejection.review.not-found"));
			}
			yield* requireDeclaredProperties(
				target,
				mediaReviewDeclaredProperties(target.entitySchemaSlug),
			);
			const { position, consumptionEventId } = input;
			const positionError = reviewPositionError(target.entitySchemaSlug, position);
			if (positionError !== undefined) {
				return yield* reject(positionError);
			}
			if (
				consumptionEventId &&
				consumptionEventId !== input.expected.properties["consumptionEventId"]
			) {
				yield* requireReviewConsumption(host, {
					eventId: consumptionEventId,
					entityId: input.expected.entityId,
				});
			}
			const { set, remove } = reviewPropertiesPatch(input);
			return {
				output: { count: 1 },
				changes: {
					events: {
						changes: [
							updateEventChange(
								EventId.make(target.id),
								{
									properties: {
										set: {
											...set,
											...(position ? { position } : {}),
											...(consumptionEventId ? { consumptionEventId } : {}),
										},
										remove: [
											...remove,
											...(position === null ? ["position"] : []),
											...(consumptionEventId === null ? ["consumptionEventId"] : []),
										],
									},
								},
								expectedEventFields(input.expected),
							),
						],
					},
				},
			};
		}),
});
