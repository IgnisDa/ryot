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

export const mediaEntityEditRoutePattern = (entitySchemaSlug: string) =>
	`/${entitySchemaSlug}/$entityId/edit`;

export const mediaEntityEditRoute = (entitySchemaSlug: string, entityId: string) =>
	`/${entitySchemaSlug}/${encodeURIComponent(entityId)}/edit`;

const editorRoutes: Record<
	string,
	{ readonly entitySchemaSlug: string; readonly kind: "create" | "edit" }
> = {};
for (const entitySchemaSlug of Object.keys(mediaEntityEditors)) {
	editorRoutes[mediaEntityCreateRoute(entitySchemaSlug)] = { kind: "create", entitySchemaSlug };
	editorRoutes[mediaEntityEditRoutePattern(entitySchemaSlug)] = { kind: "edit", entitySchemaSlug };
}

export const mediaEntityEditorRoutes: Readonly<typeof editorRoutes> = editorRoutes;
