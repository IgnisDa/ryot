import { builtinMediaEntitySchemaSlugs } from "#modules/builtins/media-schema-slugs";

export const mediaMonitorableEntitySchemaSlugs = [
	"company",
	"person",
	...builtinMediaEntitySchemaSlugs,
] as const;

const mediaMonitorableEntitySchemaSlugSet = new Set(mediaMonitorableEntitySchemaSlugs);

export const isMediaMonitorableEntity = (entity: {
	entityUserId: string | null;
	entitySchemaSlug: string;
	provenance: { externalId: string; sandboxScriptId: string } | null;
}) =>
	entity.entityUserId === null &&
	entity.provenance !== null &&
	mediaMonitorableEntitySchemaSlugSet.has(entity.entitySchemaSlug);
