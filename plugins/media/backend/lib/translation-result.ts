import type { MediaImage } from "../../shared/media-image";

export const mediaTranslationResult = (
	name: null | string,
	description: null | string,
	localizedArtwork: null | undefined | MediaImage,
) => ({
	...(name ? { name } : {}),
	...(description || localizedArtwork
		? {
				properties: {
					...(description ? { description } : {}),
					...(localizedArtwork ? { localizedArtwork } : {}),
				},
			}
		: {}),
});
