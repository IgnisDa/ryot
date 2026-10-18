export const mediaLibraryMembership = {
	librarySchemaSlug: "media-library",
	relationshipSlug: "in-media-library",
} as const;

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

export const positionalProperties = {
	anime: { total: "episodes", position: "animeEpisode" },
	manga: { total: "chapters", position: "mangaChapter" },
} as const;

export const isPositional = (
	entitySchemaSlug: string,
): entitySchemaSlug is keyof typeof positionalProperties =>
	entitySchemaSlug === "anime" || entitySchemaSlug === "manga";

export const flatMediaSchemaSlugs = builtinMediaEntitySchemaSlugs.filter(
	(slug) => slug !== "show" && slug !== "podcast",
);

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

export type MediaArtworkSchemaSlug =
	MediaGroupSlug | (typeof builtinMediaEntitySchemaSlugs)[number];

export type MediaCreatorCreditSlug =
	(typeof creatorGroupTargetSlugs)[number] | (typeof builtinMediaEntitySchemaSlugs)[number];

export const mediaLibraryMemberEntitySchemaSlugs = [
	"person",
	"company",
	...mediaGroupSlugs,
	...builtinMediaEntitySchemaSlugs,
	"show-season",
	"show-episode",
	"podcast-episode",
] as const;

export const mediaLibraryEligibleEntitySchemaSlugs = [
	"media-library",
	...mediaLibraryMemberEntitySchemaSlugs,
] as const;
