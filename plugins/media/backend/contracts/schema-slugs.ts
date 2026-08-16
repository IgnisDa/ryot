import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

export const mediaLibraryEligibleEntitySchemaSlugs = [
	"library",
	"person",
	"company",
	"movie-group",
	"audiobook-group",
	"book-group",
	"comic-book-group",
	"music-group",
	"video-game-group",
	...builtinMediaEntitySchemaSlugs,
	"show-season",
	"show-episode",
	"podcast-episode",
] as const;
