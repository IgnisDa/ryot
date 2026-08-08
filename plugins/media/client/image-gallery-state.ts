import { mediaImagePurposes, type MediaImage } from "../shared/media-image";
import { mediaGalleryImages, type MediaGalleryImage } from "./media-image";

type MediaImagePurpose = NonNullable<MediaImage["purpose"]>;

export type GalleryFilter = "all" | "other" | MediaImagePurpose;

export type GalleryFilterOption = {
	readonly count: number;
	readonly label: string;
	readonly filter: GalleryFilter;
};

const PURPOSE_LABELS: Record<MediaImagePurpose, string> = {
	logo: "Logos",
	still: "Stills",
	cover: "Covers",
	artwork: "Artwork",
	profile: "Profiles",
	backdrop: "Backdrops",
	screenshot: "Screenshots",
};

export const galleryFilterLabel = (filter: GalleryFilter) => {
	if (filter === "all") {
		return "All";
	}
	return filter === "other" ? "Other" : PURPOSE_LABELS[filter];
};

const filterOf = (image: MediaGalleryImage): Exclude<GalleryFilter, "all"> =>
	image.purpose ?? "other";

export const galleryImages = mediaGalleryImages;

export const galleryFilterImages = (images: readonly MediaGalleryImage[], filter: GalleryFilter) =>
	filter === "all" ? images : images.filter((image) => filterOf(image) === filter);

export const galleryFilters = (
	images: readonly MediaGalleryImage[],
): readonly GalleryFilterOption[] => {
	const present = [...mediaImagePurposes, "other" as const].flatMap((filter) => {
		const count = galleryFilterImages(images, filter).length;
		return count === 0 ? [] : [{ count, filter, label: galleryFilterLabel(filter) }];
	});
	if (present.length < 2) {
		return [];
	}
	return [{ filter: "all", count: images.length, label: galleryFilterLabel("all") }, ...present];
};

export const galleryTileFit = (filter: GalleryFilter) => (filter === "all" ? "contain" : "cover");

export const galleryTileAspect = (filter: GalleryFilter) => {
	if (filter === "all") {
		return "aspect-3/2";
	}
	if (filter === "cover" || filter === "profile") {
		return "aspect-2/3";
	}
	return filter === "logo" ? "aspect-5/2" : "aspect-video";
};

export const galleryTileColumns = (filter: GalleryFilter, compact: boolean) => {
	const tall = filter === "cover" || filter === "profile";
	if (compact) {
		return tall ? "grid-cols-3" : "grid-cols-2";
	}
	return tall ? "grid-cols-6" : "grid-cols-4";
};

export const galleryStep = (index: number, count: number, direction: 1 | -1) => {
	const next = index + direction;
	if (next < 0 || next >= count) {
		return index;
	}
	return next;
};

export const galleryCountLabel = (count: number) => `${count} ${count === 1 ? "image" : "images"}`;
