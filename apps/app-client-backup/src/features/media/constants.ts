export const MEDIA_SCOPE_SLUGS = [
	"book",
	"show",
	"anime",
	"manga",
	"music",
	"movie",
	"person",
	"podcast",
	"audiobook",
	"comic-book",
	"video-game",
	"visual-novel",
] as const;

export type MediaScopeSlug = (typeof MEDIA_SCOPE_SLUGS)[number];
