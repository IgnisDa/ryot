import type { MediaArtworkSchemaSlug } from "../shared/media-schema-slugs";
import type { MediaArtworkAspect } from "./media/entity-presentation";

export const mediaSchemaAspects: Record<MediaArtworkSchemaSlug, MediaArtworkAspect> = {
	book: "poster",
	show: "poster",
	manga: "poster",
	movie: "poster",
	anime: "poster",
	music: "square",
	podcast: "square",
	audiobook: "square",
	"book-group": "poster",
	"comic-book": "poster",
	"video-game": "poster",
	"movie-group": "poster",
	"music-group": "square",
	"visual-novel": "poster",
	"audiobook-group": "square",
	"comic-book-group": "poster",
	"video-game-group": "poster",
};

const isMediaArtworkSchemaSlug = (slug: string): slug is MediaArtworkSchemaSlug =>
	Object.hasOwn(mediaSchemaAspects, slug);

export const mediaAspectOf = (slug: string): MediaArtworkAspect =>
	isMediaArtworkSchemaSlug(slug) ? mediaSchemaAspects[slug] : "poster";
