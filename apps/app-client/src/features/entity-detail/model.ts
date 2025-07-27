import { MEDIA_SCOPE_SLUGS } from "../media/constants";
import type { EntityDetail, EntityResponse, SupportedEntitySchemaSlug } from "./types";

const SUPPORTED_ENTITY_SCHEMA_SLUGS = MEDIA_SCOPE_SLUGS.filter(
	(slug): slug is SupportedEntitySchemaSlug => slug !== "person",
);

export function isEntitySchemaSlug(value: string): value is SupportedEntitySchemaSlug {
	return SUPPORTED_ENTITY_SCHEMA_SLUGS.some((slug) => slug === value);
}

export function toEntityDetail<TSlug extends SupportedEntitySchemaSlug>(
	entity: EntityResponse,
	entitySchemaSlug: TSlug,
): Extract<EntityDetail, { entitySchemaSlug: TSlug }>;

export function toEntityDetail(
	entity: EntityResponse,
	entitySchemaSlug: SupportedEntitySchemaSlug,
): EntityResponse & { entitySchemaSlug: SupportedEntitySchemaSlug } {
	return { ...entity, entitySchemaSlug };
}
