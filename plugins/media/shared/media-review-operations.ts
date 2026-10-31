import { Schema } from "@ryot-app/plugin-kit/effect";

import { MediaEventSnapshot, mediaSubmissionFields } from "./media-activity-operations";

const ReviewRating = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
);

export const MediaReviewContent = Schema.Struct({
	isSpoiler: Schema.Boolean,
	text: Schema.NullOr(Schema.Trim),
	rating: Schema.NullOr(ReviewRating),
});

const requireReviewContent = Schema.makeFilter<typeof MediaReviewContent.Type>(
	({ text, rating }) =>
		(text !== null && text.length > 0) || rating !== null || "Add a rating, a review, or both.",
);

export const MediaReviewCreateInput = Schema.Struct({
	...MediaReviewContent.fields,
	entityId: Schema.NonEmptyString,
}).pipe(Schema.check(requireReviewContent));

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
	...MediaReviewContent.fields,
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
