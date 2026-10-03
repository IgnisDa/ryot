import type { EntityEditorAllowlist } from "@ryot-app/plugin-kit/schema";

import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
	mediaGroupMemberSlugs,
	mediaGroupSlugs,
} from "./media-schema-slugs";

export const mediaEntitySaveOperationSlug = "media-entity-save";

const creditRelationshipSlugs = (source: "company" | "person") =>
	[...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs].map(
		(target) => `${source}-to-${target}`,
	);

export const mediaEntityEditors: EntityEditorAllowlist = {
	...Object.fromEntries(builtinMediaEntitySchemaSlugs.map((slug) => [slug, []])),
	"video-game": ["video-game-to-video-game"],
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
