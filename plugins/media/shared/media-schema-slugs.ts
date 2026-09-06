export const mediaPluginSlug = "media";

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

export const mediaGroupMemberSlugs = {
	"book-group": "book",
	"movie-group": "movie",
	"music-group": "music",
	"audiobook-group": "audiobook",
	"comic-book-group": "comic-book",
	"video-game-group": "video-game",
} as const;

export type MediaGroupSlug = keyof typeof mediaGroupMemberSlugs;

export const mediaGroupSlugs = [
	"movie-group",
	"audiobook-group",
	"book-group",
	"comic-book-group",
	"music-group",
	"video-game-group",
] as const satisfies readonly MediaGroupSlug[];

export const creatorGroupTargetSlugs = [
	"music-group",
	"video-game-group",
] as const satisfies readonly MediaGroupSlug[];

export type MediaCreatorCreditSlug =
	| (typeof builtinMediaEntitySchemaSlugs)[number]
	| (typeof creatorGroupTargetSlugs)[number];

export type MediaArtworkSchemaSlug =
	| (typeof builtinMediaEntitySchemaSlugs)[number]
	| MediaGroupSlug;
