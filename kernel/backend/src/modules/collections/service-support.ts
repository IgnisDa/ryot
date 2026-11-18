import type { CollectionResponse } from "@ryot-app/contract/modules/collections/schemas";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";

export const toCollectionResponse = (entity: ListedEntity): CollectionResponse => ({
	id: entity.id,
	name: entity.name,
	entitySchemaPluginId: null,
	createdAt: entity.createdAt,
	updatedAt: entity.updatedAt,
	properties: entity.properties,
	externalId: entity.externalId,
	providerId: entity.providerId,
	entitySchemaSlug: entity.entitySchemaSlug,
});
