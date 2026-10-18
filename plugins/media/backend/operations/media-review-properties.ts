import type { MediaReviewContent } from "../../shared/media-review-operations";

export const mediaReviewProperties = (input: typeof MediaReviewContent.Type) => ({
	...(input.text ? { text: input.text, isSpoiler: input.isSpoiler } : {}),
	...(input.rating === null ? {} : { rating: input.rating }),
});
