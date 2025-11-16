import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema, type ImageSchemaType } from "~/lib/db/schema";
import type { EntityPropertiesShape } from "./service";

const entitySchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(entitySchema.userId), eq(entitySchema.userId, userId));
};

const entitySelection = {
	id: entity.id,
	name: entity.name,
	image: entity.image,
	createdAt: entity.createdAt,
	updatedAt: entity.updatedAt,
	externalId: entity.externalId,
	properties: entity.properties,
	entitySchemaId: entity.entitySchemaId,
	detailsSandboxScriptId: entity.detailsSandboxScriptId,
};

export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select({
			id: entitySchema.id,
			userId: entitySchema.userId,
			isBuiltin: entitySchema.isBuiltin,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.id, input.entitySchemaId),
				entitySchemaVisibleToUserClause(input.userId),
			),
		)
		.limit(1);

	return foundEntitySchema;
};

export const getEntityScopeForUser = async (input: {
	userId: string;
	entityId: string;
}) => {
	const [foundEntity] = await db
		.select({
			entityId: entity.id,
			isBuiltin: entitySchema.isBuiltin,
			entitySchemaId: entity.entitySchemaId,
		})
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(and(eq(entity.id, input.entityId), eq(entity.userId, input.userId)))
		.limit(1);

	return foundEntity;
};

export const getEntityByIdForUser = async (input: {
	userId: string;
	entityId: string;
}) => {
	const [foundEntity] = await db
		.select(entitySelection)
		.from(entity)
		.where(and(eq(entity.id, input.entityId), eq(entity.userId, input.userId)))
		.limit(1);

	return foundEntity
		? {
				...foundEntity,
				properties: foundEntity.properties as EntityPropertiesShape,
			}
		: foundEntity;
};

export const listEntitiesByEntitySchemaForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const rows = await db
		.select(entitySelection)
		.from(entity)
		.where(
			and(
				eq(entity.userId, input.userId),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(asc(entity.name), asc(entity.createdAt));

	return rows.map((row) => ({
		...row,
		properties: row.properties as EntityPropertiesShape,
	}));
};

export const createEntityForUser = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
	image: ImageSchemaType | null;
	properties: EntityPropertiesShape;
}) => {
	const [createdEntity] = await db
		.insert(entity)
		.values({
			name: input.name,
			externalId: null,
			image: input.image,
			userId: input.userId,
			properties: input.properties,
			detailsSandboxScriptId: null,
			entitySchemaId: input.entitySchemaId,
		})
		.returning(entitySelection);

	if (!createdEntity) throw new Error("Could not persist entity");

	return {
		...createdEntity,
		properties: createdEntity.properties as EntityPropertiesShape,
	};
};
