import { Schema } from "@ryot-app/plugin-kit/effect";
import { requireReviewContent, ReviewContent } from "@ryot-app/plugin-kit/schema";

import { MediaPosition, mediaPositionError } from "./consumption";
import { MediaEventSnapshot, mediaSubmissionFields } from "./media-activity-operations";

/** The records a review can be about: one occurrence of consuming its subject. */
export const mediaReviewConsumptionSlugs = [
	"complete",
	"item-complete",
	"progress",
	"dropped",
	"on_hold",
] as const;

const reviewPositionField = { position: Schema.optionalKey(Schema.NullOr(MediaPosition)) };

const reviewConsumptionField = {
	consumptionEventId: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
};

export const MediaReviewCreateInput = Schema.Struct({
	...reviewPositionField,
	...reviewConsumptionField,
	...ReviewContent.fields,
	entityId: Schema.NonEmptyString,
}).pipe(Schema.check(requireReviewContent));

export const reviewPositionError = (
	entitySchemaSlug: string,
	position: null | undefined | MediaPosition,
) => {
	if (position === undefined || position === null) {
		return undefined;
	}
	return mediaPositionError(entitySchemaSlug, position);
};

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
	...reviewPositionField,
	...reviewConsumptionField,
	...ReviewContent.fields,
	expected: MediaEventSnapshot,
	eventId: Schema.NonEmptyString,
}).pipe(Schema.check(requireReviewContent));

export type MediaReviewUpdateInput = typeof MediaReviewUpdateInput.Type;

export const MediaReviewDeleteInput = Schema.Struct({
	...mediaSubmissionFields,
	eventId: Schema.NonEmptyString,
});

export type MediaReviewDeleteInput = typeof MediaReviewDeleteInput.Type;

export const MediaReviewOutput = Schema.Struct({ count: Schema.Int });
