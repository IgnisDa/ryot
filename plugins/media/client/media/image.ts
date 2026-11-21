import type { MediaImageAsset } from "../../shared/media-image";

export const imageRendition = (image: MediaImageAsset, size: "large" | "thumbnail") => {
	if (image.type !== "remote") {
		return image;
	}
	return {
		type: "remote" as const,
		url: (size === "thumbnail" ? image.thumbnailUrl : image.largeUrl) ?? image.url,
	};
};
