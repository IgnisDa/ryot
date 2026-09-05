import { builtinMediaEntitySchemaSlugs, mediaGroupSlugs } from "../../shared/media-schema-slugs";

export const mediaLibraryEligibleEntitySchemaSlugs = [
	"library",
	"person",
	"company",
	...mediaGroupSlugs,
	...builtinMediaEntitySchemaSlugs,
	"show-season",
	"show-episode",
	"podcast-episode",
] as const;
