import { Schema } from "effect";

export const ReviewRating = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
);

export const ReviewContent = Schema.Struct({
	isSpoiler: Schema.Boolean,
	text: Schema.NullOr(Schema.Trim),
	rating: Schema.NullOr(ReviewRating),
});

export type ReviewContent = typeof ReviewContent.Type;

export const requireReviewContent = Schema.makeFilter<ReviewContent>(
	({ text, rating }) =>
		(text !== null && text.length > 0) || rating !== null || "Add a rating, a review, or both.",
);

export const ReviewProperties = Schema.Struct({
	text: Schema.optional(Schema.NullOr(Schema.String)),
	rating: Schema.optional(Schema.NullOr(Schema.Finite)),
	isSpoiler: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

export const reviewPropertyKeys = ["text", "isSpoiler", "rating"] as const;

export const reviewProperties = (input: ReviewContent) => ({
	...(input.text ? { text: input.text, isSpoiler: input.isSpoiler } : {}),
	...(input.rating === null ? {} : { rating: input.rating }),
});

export const reviewPropertyFields = (textDescription: string) => ({
	text: { label: "Review", type: "string" as const, description: textDescription },
	isSpoiler: {
		type: "boolean" as const,
		label: "Contains spoilers",
		description: "Whether this review contains spoilers",
	},
	rating: {
		label: "Rating",
		type: "number" as const,
		validation: { minimum: 0, maximum: 100 },
		description: "Your personal rating from 0 (lowest) to 100 (highest)",
	},
});
