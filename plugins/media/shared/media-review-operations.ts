import { Schema } from "@ryot-app/plugin-kit/effect";

import { MediaEventSnapshot, mediaSubmissionFields } from "./media-activity-operations";

const ReviewText = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));

const ReviewRating = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
);

export const MediaReviewCreateInput = Schema.Struct({
	text: ReviewText,
	isSpoiler: Schema.Boolean,
	entityId: Schema.NonEmptyString,
	rating: Schema.optional(ReviewRating),
});

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
	text: ReviewText,
	isSpoiler: Schema.Boolean,
	expected: MediaEventSnapshot,
	eventId: Schema.NonEmptyString,
	rating: Schema.NullOr(ReviewRating),
});

export type MediaReviewUpdateInput = typeof MediaReviewUpdateInput.Type;

export const MediaReviewDeleteInput = Schema.Struct({
	...mediaSubmissionFields,
	eventId: Schema.NonEmptyString,
});

export type MediaReviewDeleteInput = typeof MediaReviewDeleteInput.Type;

export const MediaReviewOutput = Schema.Struct({ count: Schema.Int });
