import type { ListedEntity } from "#modules/entities/schemas";

import type { CollectionResponse } from "./schemas";

export const entityNotFoundError = "Entity not found";
export const collectionNotFoundError = "Collection not found";
export const circularReferenceError = "Cannot add a collection to itself";
export const invalidMembershipPropertiesError = "Membership properties validation failed";
export const invalidMembershipSchemaError = "membershipPropertiesSchema must be a valid AppSchema";

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const toCollectionResponse = (entity: ListedEntity): CollectionResponse => ({
	id: entity.id,
	name: entity.name,
	createdAt: entity.createdAt,
	updatedAt: entity.updatedAt,
	properties: entity.properties,
	externalId: entity.externalId,
	entitySchemaId: entity.entitySchemaId,
	sandboxScriptId: entity.sandboxScriptId,
});
