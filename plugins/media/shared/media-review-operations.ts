import { Schema } from "@ryot-app/plugin-kit/effect";
import { requireReviewContent, ReviewContent } from "@ryot-app/plugin-kit/schema";

import { MediaPosition, mediaPositionError } from "./consumption";
import { MediaEventSnapshot, mediaSubmissionFields } from "./media-activity-operations";
import { isPositional } from "./media-schema-slugs";

const reviewPositionField = { position: Schema.optionalKey(Schema.NullOr(MediaPosition)) };

export const MediaReviewCreateInput = Schema.Struct({
	...reviewPositionField,
	...ReviewContent.fields,
	entityId: Schema.NonEmptyString,
}).pipe(Schema.check(requireReviewContent));

export const reviewPositionError = (
	entitySchemaSlug: string,
	position: null | undefined | MediaPosition,
) => {
	if (position === undefined) {
		return undefined;
	}
	if (position === null) {
		return isPositional(entitySchemaSlug)
			? undefined
			: "This media type does not track this position";
	}
	return mediaPositionError(entitySchemaSlug, position);
};

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
	...reviewPositionField,
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
