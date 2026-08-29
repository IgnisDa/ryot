import type { MediaCreatorCreditSlug } from "../shared/media-schema-slugs";
import type { MediaArtworkAspect } from "./media/entity-presentation";

export const mediaSchemaAspects: Record<MediaCreatorCreditSlug, MediaArtworkAspect> = {
	book: "poster",
	show: "poster",
	manga: "poster",
	movie: "poster",
	anime: "poster",
	music: "square",
	podcast: "square",
	audiobook: "square",
	"comic-book": "poster",
	"video-game": "poster",
	"music-group": "square",
	"visual-novel": "poster",
	"video-game-group": "poster",
};
