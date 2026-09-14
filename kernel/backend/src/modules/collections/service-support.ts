import type { CollectionResponse } from "@ryot-app/contract/modules/collections/schemas";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const toCollectionResponse = (entity: ListedEntity): CollectionResponse => ({
	id: entity.id,
	name: entity.name,
	createdAt: entity.createdAt,
	updatedAt: entity.updatedAt,
	properties: entity.properties,
	externalId: entity.externalId,
	providerId: entity.providerId,
	entitySchemaSlug: entity.entitySchemaSlug,
});
