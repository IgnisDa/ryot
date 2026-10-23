import { Schema } from "@ryot-app/plugin-kit/effect";

export const MediaReviewCreateInput = Schema.Struct({
	isSpoiler: Schema.Boolean,
	entityId: Schema.NonEmptyString,
	text: Schema.Trim.pipe(Schema.check(Schema.isMinLength(1))),
	rating: Schema.optional(
		Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
	),
});

export type MediaReviewCreateInput = Schema.Schema.Type<typeof MediaReviewCreateInput>;

export const MediaReviewCreateOutput = Schema.Struct({ count: Schema.Int });
