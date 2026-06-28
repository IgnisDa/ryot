export const builtinMediaEntitySchemaSlugs = [
	"book",
	"comic-book",
	"anime",
	"movie",
	"show",
	"manga",
	"audiobook",
	"podcast",
	"video-game",
	"music",
	"visual-novel",
] as const;

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
