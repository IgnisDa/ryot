import { entity, entitySchema } from "./tables";

export * from "./auth";
export * from "./relations";
export * from "./tables";

export const entityAccessScopeWithSchemaJoinSelection = {
	entityId: entity.id,
	entityUserId: entity.userId,
	isBuiltin: entitySchema.isBuiltin,
	entitySchemaSlug: entitySchema.slug,
	entitySchemaId: entity.entitySchemaId,
};

export const entitySchemaAccessScopeSelection = {
	id: entitySchema.id,
	userId: entitySchema.userId,
	isBuiltin: entitySchema.isBuiltin,
};
