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

export const creatorGroupTargetSlugs = ["music-group", "video-game-group"] as const;

export type MediaCreatorCreditSlug =
	| (typeof builtinMediaEntitySchemaSlugs)[number]
	| (typeof creatorGroupTargetSlugs)[number];
