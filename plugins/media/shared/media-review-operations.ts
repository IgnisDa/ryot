import { Schema } from "@ryot-app/plugin-kit/effect";
import { requireReviewContent, ReviewContent } from "@ryot-app/plugin-kit/schema";

import { MediaEventSnapshot, mediaSubmissionFields } from "./media-activity-operations";

export const MediaReviewCreateInput = Schema.Struct({
	...ReviewContent.fields,
	entityId: Schema.NonEmptyString,
}).pipe(Schema.check(requireReviewContent));

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
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
