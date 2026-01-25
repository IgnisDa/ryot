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

export type BuiltinMediaEntitySchemaSlug = (typeof builtinMediaEntitySchemaSlugs)[number];
