import { builtinMediaEntitySchemaSlugs } from "#modules/builtins/media-schema-slugs";

export const monitorAbleEntitySchemaSlugs = [
	"company",
	"person",
	...builtinMediaEntitySchemaSlugs,
] as const;

const mediaEntitySchemaSlugSet = new Set(builtinMediaEntitySchemaSlugs);
const monitorAbleEntitySchemaSlugSet = new Set(monitorAbleEntitySchemaSlugs);

export const isMonitorAbleEntity = (entity: {
	entityUserId: string | null;
	entitySchemaSlug: string;
	provenance: { externalId: string; sandboxScriptId: string } | null;
}) =>
	entity.entityUserId === null &&
	entity.provenance !== null &&
	monitorAbleEntitySchemaSlugSet.has(entity.entitySchemaSlug);

export const isMonitoringAssociationTargetSchema = (entitySchemaSlug: string) =>
	mediaEntitySchemaSlugSet.has(entitySchemaSlug) || entitySchemaSlug.endsWith("-group");
