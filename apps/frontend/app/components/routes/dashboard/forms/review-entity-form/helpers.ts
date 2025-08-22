import {
	type CreateOrUpdateReviewInput,
	EntityLot,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { convertDecimalToThreePointSmiley } from "~/lib/shared/media-utils";
import type { ReviewEntityData } from "~/lib/state/media";
import type { ThreePointSmileyRating } from "~/lib/types";

export interface ReviewFormValues extends CreateOrUpdateReviewInput {
	showSeasonNumberString?: string;
	showEpisodeNumberString?: string;
	podcastEpisodeNumberString?: string;
	ratingInThreePointSmiley?: ThreePointSmileyRating;
}

export const initializeFormValues = (
	entityToReview: ReviewEntityData | null,
): ReviewFormValues => {
	if (!entityToReview) {
		return {
			entityId: "",
			entityLot: EntityLot.Metadata,
			text: "",
			isSpoiler: false,
			visibility: Visibility.Public,
		};
	}

	const existingReview = entityToReview.existingReview;

	return {
		entityId: entityToReview.entityId,
		reviewId: existingReview?.id,
		text: existingReview?.textOriginal || "",
		entityLot: entityToReview.entityLot,
		isSpoiler: existingReview?.isSpoiler || false,
		visibility: existingReview?.visibility || Visibility.Public,
		showSeasonNumber: existingReview?.showExtraInformation?.season,
		showEpisodeNumber: existingReview?.showExtraInformation?.episode,
		mangaVolumeNumber: existingReview?.mangaExtraInformation?.volume,
		animeEpisodeNumber: existingReview?.animeExtraInformation?.episode,
		mangaChapterNumber: existingReview?.mangaExtraInformation?.chapter,
		podcastEpisodeNumber: existingReview?.podcastExtraInformation?.episode,
		rating: existingReview?.rating || undefined,
		ratingInThreePointSmiley: existingReview?.rating
			? convertDecimalToThreePointSmiley(Number(existingReview.rating))
			: undefined,
		showSeasonNumberString:
			existingReview?.showExtraInformation?.season?.toString(),
		showEpisodeNumberString:
			existingReview?.showExtraInformation?.episode?.toString(),
		podcastEpisodeNumberString:
			existingReview?.podcastExtraInformation?.episode?.toString(),
	};
};

export const prepareReviewInput = (
	formValues: ReviewFormValues,
): CreateOrUpdateReviewInput => {
	return {
		text: formValues.text,
		rating: formValues.rating,
		entityId: formValues.entityId,
		reviewId: formValues.reviewId,
		entityLot: formValues.entityLot,
		isSpoiler: formValues.isSpoiler,
		visibility: formValues.visibility,
		showSeasonNumber: formValues.showSeasonNumber,
		showEpisodeNumber: formValues.showEpisodeNumber,
		mangaVolumeNumber: formValues.mangaVolumeNumber,
		animeEpisodeNumber: formValues.animeEpisodeNumber,
		mangaChapterNumber: formValues.mangaChapterNumber,
		podcastEpisodeNumber: formValues.podcastEpisodeNumber,
	};
};
