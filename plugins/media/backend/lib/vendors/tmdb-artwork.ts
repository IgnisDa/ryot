import type { MediaImage } from "../../../shared/media-image";
import { stringValue } from "../records";

export type TmdbImagePurpose = Extract<
	MediaImage["purpose"],
	"logo" | "cover" | "still" | "profile" | "backdrop"
>;

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const tmdbImageSizes = {
	logo: { large: "w500", display: "w342", thumbnail: "w154" },
	cover: { large: "w780", display: "w500", thumbnail: "w185" },
	backdrop: { large: "w1280", display: "w780", thumbnail: "w300" },
	still: { display: "w300", large: "original", thumbnail: "w185" },
	profile: { display: "h632", large: "original", thumbnail: "w185" },
} satisfies Record<TmdbImagePurpose, { large: string; display: string; thumbnail: string }>;

export const getImageUrl = (path: unknown, purpose: TmdbImagePurpose = "cover") =>
	tmdbArtwork(path, purpose)?.url ?? null;

export const tmdbArtwork = (path: unknown, purpose: TmdbImagePurpose, language?: string) => {
	const file = stringValue(path);
	if (file === null || !file.startsWith("/")) {
		return undefined;
	}
	const sizes = tmdbImageSizes[purpose];
	const size = (value: string) =>
		`${TMDB_IMAGE_BASE}/${file.endsWith(".svg") ? "original" : value}${file}`;
	return {
		purpose,
		sourceId: file,
		type: "remote" as const,
		url: size(sizes.display),
		largeUrl: size(sizes.large),
		thumbnailUrl: size(sizes.thumbnail),
		...(language === undefined ? {} : { language }),
	};
};

export function normalizeStoredTmdbArtwork(image: MediaImage): MediaImage {
	const prefix = `${TMDB_IMAGE_BASE}/original`;
	if (
		image.type !== "remote" ||
		!image.url.startsWith(`${prefix}/`) ||
		image.purpose === "artwork" ||
		image.purpose === "screenshot"
	) {
		return image;
	}
	return tmdbArtwork(image.url.slice(prefix.length), image.purpose, image.language) ?? image;
}
