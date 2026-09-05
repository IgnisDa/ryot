import { builtinMediaEntitySchemaSlugs, mediaGroupSlugs } from "../../shared/media-schema-slugs";

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
