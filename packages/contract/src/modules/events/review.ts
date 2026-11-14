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

type ReviewPropertiesInput = {
	readonly text: null | string;
	readonly isSpoiler?: boolean;
	readonly rating: null | number;
};

export const reviewProperties = ({ text, rating, isSpoiler }: ReviewPropertiesInput) => ({
	...(text ? { text, ...(isSpoiler === undefined ? {} : { isSpoiler }) } : {}),
	...(rating === null ? {} : { rating }),
});

export const reviewPropertiesPatch = (input: ReviewPropertiesInput) => {
	const set = reviewProperties(input);
	return { set, remove: reviewPropertyKeys.filter((key) => !Object.hasOwn(set, key)) };
};

export const reviewRatingField = {
	label: "Rating",
	type: "number" as const,
	validation: { minimum: 0, maximum: 100 },
	description: "Your personal rating from 0 (lowest) to 100 (highest)",
};

export const reviewPropertyFields = (textDescription: string) => ({
	rating: reviewRatingField,
	text: { label: "Review", type: "string" as const, description: textDescription },
	isSpoiler: {
		type: "boolean" as const,
		label: "Contains spoilers",
		description: "Whether this review contains spoilers",
	},
});
