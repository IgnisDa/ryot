import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
	mediaGroupMemberSlugs,
	mediaGroupSlugs,
} from "./media-schema-slugs";

const creditRelationshipSlugs = (source: "company" | "person") =>
	[...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs].map(
		(target) => `${source}-to-${target}`,
	);

export const mediaEntityEditors: Readonly<Record<string, readonly string[]>> = {
	...Object.fromEntries(builtinMediaEntitySchemaSlugs.map((slug) => [slug, [`${slug}-to-genre`]])),
	genre: [],
	"video-game": ["video-game-to-video-game", "video-game-to-genre"],
	...Object.fromEntries(
		mediaGroupSlugs.map((group) => [group, [`${group}-to-${mediaGroupMemberSlugs[group]}`]]),
	),
	person: creditRelationshipSlugs("person"),
	company: creditRelationshipSlugs("company"),
};

export const mediaEntityCreateRoute = (entitySchemaSlug: string) => `/${entitySchemaSlug}/new`;

export const mediaEntityEditorRoutes = Object.fromEntries(
	Object.keys(mediaEntityEditors).map((slug) => [mediaEntityCreateRoute(slug), slug]),
);
