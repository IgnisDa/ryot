import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import {
	entity,
	entityAccessScopeWithSchemaJoinSelection,
	entitySchema,
	entitySchemaAccessScopeSelection,
	type ImageSchemaType,
	relationship,
} from "~/lib/db/schema";
import type { ListedEntity } from "./schemas";
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
	sandboxScriptId: entity.sandboxScriptId,
};

const entitySchemaScopeSelection = {
	...entitySchemaAccessScopeSelection,
	propertiesSchema: entitySchema.propertiesSchema,
};

type EntityRow = Omit<ListedEntity, "properties"> & {
	properties: unknown;
};

const toListedEntity = (row: EntityRow): ListedEntity => ({
	...row,
	properties: row.properties as EntityPropertiesShape,
});

export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select(entitySchemaScopeSelection)
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
		.select(entityAccessScopeWithSchemaJoinSelection)
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.id, input.entityId),
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
			),
		)
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
		.where(
			and(
				eq(entity.id, input.entityId),
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
			),
		)
		.limit(1);

	return foundEntity ? toListedEntity(foundEntity) : foundEntity;
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
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(asc(entity.name), asc(entity.createdAt));

	return rows.map(toListedEntity);
};

export const findEntityByExternalIdForUser = async (input: {
	userId: string;
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) => {
	const [foundEntity] = await db
		.select(entitySelection)
		.from(entity)
		.where(
			and(
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
				eq(entity.externalId, input.externalId),
				eq(entity.entitySchemaId, input.entitySchemaId),
				eq(entity.sandboxScriptId, input.sandboxScriptId),
			),
		)
		.limit(1);

	return foundEntity ? toListedEntity(foundEntity) : undefined;
};

export const createEntityForUser = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
	externalId?: string | null;
	image: ImageSchemaType | null;
	sandboxScriptId?: string | null;
	properties: EntityPropertiesShape;
}) => {
	const [createdEntity] = await db
		.insert(entity)
		.values({
			name: input.name,
			image: input.image,
			userId: input.userId,
			properties: input.properties,
			externalId: input.externalId ?? null,
			entitySchemaId: input.entitySchemaId,
			sandboxScriptId: input.sandboxScriptId ?? null,
		})
		.returning(entitySelection);

	if (!createdEntity) {
		throw new Error("Could not persist entity");
	}

	return toListedEntity(createdEntity);
};

export const findGlobalEntityByExternalId = async (input: {
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) => {
	const [foundEntity] = await db
		.select(entitySelection)
		.from(entity)
		.where(
			and(
				isNull(entity.userId),
				eq(entity.externalId, input.externalId),
				eq(entity.entitySchemaId, input.entitySchemaId),
				eq(entity.sandboxScriptId, input.sandboxScriptId),
			),
		)
		.limit(1);

	return foundEntity ? toListedEntity(foundEntity) : undefined;
};

export const createGlobalEntity = async (input: {
	name: string;
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) => {
	const [createdEntity] = await db
		.insert(entity)
		.values({
			image: null,
			userId: null,
			properties: {},
			name: input.name,
			externalId: input.externalId,
			entitySchemaId: input.entitySchemaId,
			sandboxScriptId: input.sandboxScriptId,
		})
		.onConflictDoNothing()
		.returning(entitySelection);

	if (createdEntity) {
		return toListedEntity(createdEntity);
	}

	const existing = await findGlobalEntityByExternalId(input);
	if (!existing) {
		throw new Error("Could not persist or find global entity after conflict");
	}

	return existing;
};

export const updateGlobalEntityById = async (input: {
	name: string;
	entityId: string;
	entitySchemaId: string;
	image: ImageSchemaType | null;
	properties: EntityPropertiesShape;
}) => {
	await db
		.update(entity)
		.set({
			name: input.name,
			image: input.image,
			properties: sql`${entity.properties} || ${JSON.stringify(input.properties)}::jsonb`,
		})
		.where(
			and(
				eq(entity.id, input.entityId),
				isNull(entity.userId),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		);
};

export const upsertPersonRelationship = async (input: {
	relType: string;
	sourceEntityId: string;
	targetEntityId: string;
	properties: Record<string, unknown>;
}) => {
	await db
		.insert(relationship)
		.values({
			relType: input.relType,
			properties: input.properties,
			sourceEntityId: input.sourceEntityId,
			targetEntityId: input.targetEntityId,
		})
		.onConflictDoUpdate({
			set: { properties: input.properties },
			targetWhere: isNull(relationship.userId),
			target: [
				relationship.sourceEntityId,
				relationship.targetEntityId,
				relationship.relType,
			],
		});
};

export const getUserLibraryEntityId = async (
	input: { userId: string },
	database: DbClient = db,
) => {
	const [found] = await database
		.select({ id: entity.id })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.userId, input.userId),
				eq(entitySchema.slug, "library"),
				isNull(entitySchema.userId),
			),
		)
		.limit(1);

	return found?.id;
};

type InLibraryRelationshipValues = {
	userId: string;
	relType: "in_library";
	sourceEntityId: string;
	targetEntityId: string;
	properties: Record<string, unknown>;
};

const insertInLibraryRelationship = async (
	values: InLibraryRelationshipValues,
) => {
	await db
		.insert(relationship)
		.values(values)
		.onConflictDoNothing({
			target: [
				relationship.userId,
				relationship.sourceEntityId,
				relationship.targetEntityId,
				relationship.relType,
			],
		});
};

export const upsertInLibraryRelationship = async (
	input: { userId: string; mediaEntityId: string; libraryEntityId: string },
	insert: (
		values: InLibraryRelationshipValues,
	) => Promise<void> = insertInLibraryRelationship,
) => {
	await insert({
		properties: {},
		userId: input.userId,
		relType: "in_library",
		sourceEntityId: input.mediaEntityId,
		targetEntityId: input.libraryEntityId,
	});
};
