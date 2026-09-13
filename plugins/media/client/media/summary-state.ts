import type { SelectedRow } from "@ryot-app/client-sdk/ryotql";

import type { MediaSummarySelection } from "../../shared/media-recipes";
import {
	collectManagedAssetLocators,
	mediaImageAsset,
	mediaImageAssets,
	preferredMediaImageAsset,
	type MediaImages,
} from "./image";

export type MediaSummaryFields = SelectedRow<MediaSummarySelection>;

export type MediaCollectionList = {
	readonly items: readonly unknown[];
	readonly pageInfo: { readonly hasMore: boolean };
};

export type MediaSummaryFact = {
	readonly icon: string;
	readonly label: string;
	readonly value: string;
	readonly suffix?: string | undefined;
	readonly iconClass?: string;
};

const MEDIA_GALLERY_LIMIT = 10;

const RATING_SUFFIX = " / 100";

type MediaImaged = { readonly images: MediaImages };

export const mediaPosterAsset = (media: MediaImaged) =>
	preferredMediaImageAsset(media.images, "cover");

export const mediaBackdropAsset = (media: MediaImaged) => mediaImageAsset(media.images, "backdrop");

export const mediaGalleryAssets = (media: MediaImaged) =>
	mediaImageAssets(media.images).slice(0, MEDIA_GALLERY_LIMIT);

export const mediaManagedAssets = (media: MediaImaged) =>
	collectManagedAssetLocators([
		mediaPosterAsset(media),
		mediaBackdropAsset(media),
		...mediaImageAssets(media.images),
	]);

export const mediaReleaseLabel = (media: {
	readonly publishDate: string | null;
	readonly publishYear: number | null;
}) => (media.publishYear === null ? (media.publishDate ?? undefined) : String(media.publishYear));

export const mediaRatingLabel = (
	media: { readonly providerRating: number | null },
	locales?: Intl.LocalesArgument,
) =>
	media.providerRating === null
		? undefined
		: new Intl.NumberFormat(locales, { maximumFractionDigits: 2 }).format(media.providerRating);

export const mediaRatingFact = (media: {
	readonly providerName: string | null;
	readonly providerRating: number | null;
}): MediaSummaryFact | undefined => {
	const value = mediaRatingLabel(media);
	return value === undefined
		? undefined
		: {
				value,
				icon: "star",
				suffix: RATING_SUFFIX,
				iconClass: "text-accent-text",
				label: media.providerName === null ? "Provider rating" : `${media.providerName} rating`,
			};
};

export const mediaOwnershipLabel = (owned: boolean | null) => {
	if (owned === null) {
		return "Not recorded";
	}
	return owned ? "Owned" : "Not owned";
};

export const mediaCountLabel = (count: number, singular: string) =>
	`${count} ${count === 1 ? singular : `${singular}s`}`;

export const mediaCountFact = (count: number | null, singular: string) =>
	count === null
		? undefined
		: { value: String(count), label: count === 1 ? singular : `${singular}s` };

export const mediaCollectionsLabel = ({ items, pageInfo }: MediaCollectionList) => {
	if (items.length === 0) {
		return "Not in any collection";
	}
	return pageInfo.hasMore
		? `${items.length}+ collections`
		: mediaCountLabel(items.length, "collection");
};
