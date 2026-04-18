import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { assertPersisted, type DbClient, db } from "~/lib/db";
import {
	entity,
	entityAccessScopeWithSchemaJoinSelection,
	entitySchema,
	entitySchemaAccessScopeSelection,
	relationship,
} from "~/lib/db/schema";
import type { ImageSchemaType } from "~/lib/zod";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";

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
	populatedAt: entity.populatedAt,
	entitySchemaId: entity.entitySchemaId,
	sandboxScriptId: entity.sandboxScriptId,
};

const entityMatchSelection = {
	...entitySelection,
	userId: entity.userId,
};

const entitySchemaScopeSelection = {
	...entitySchemaAccessScopeSelection,
	propertiesSchema: entitySchema.propertiesSchema,
};

const relationshipSelection = {
	id: relationship.id,
	createdAt: relationship.createdAt,
	properties: relationship.properties,
	sourceEntityId: relationship.sourceEntityId,
	targetEntityId: relationship.targetEntityId,
	relationshipSchemaId: relationship.relationshipSchemaId,
};

export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select(entitySchemaScopeSelection)
		.from(entitySchema)
		.where(
			and(eq(entitySchema.id, input.entitySchemaId), entitySchemaVisibleToUserClause(input.userId)),
		)
		.limit(1);

	return foundEntitySchema;
};

export const getEntityScopeForUser = async (input: { userId: string; entityId: string }) => {
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

export const getEntityByIdForUser = async (input: { userId: string; entityId: string }) => {
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

	return foundEntity;
};

export const listEntityMatchCandidatesBySchemaForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const rows = await db
		.select(entityMatchSelection)
		.from(entity)
		.where(
			and(
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(
			sql`case when ${entity.userId} = ${input.userId} then 0 else 1 end`,
			asc(entity.name),
			asc(entity.createdAt),
		);

	return rows;
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

	return foundEntity;
};

export const createEntityForUser = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
	externalId?: string | null;
	image: ImageSchemaType | null;
	sandboxScriptId?: string | null;
	properties: Record<string, unknown>;
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

	return assertPersisted(createdEntity, "entity");
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

	return foundEntity;
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
			populatedAt: null,
			externalId: input.externalId,
			entitySchemaId: input.entitySchemaId,
			sandboxScriptId: input.sandboxScriptId,
		})
		.onConflictDoNothing()
		.returning(entitySelection);

	if (createdEntity) {
		return { entity: createdEntity, isNew: true };
	}

	const existing = await findGlobalEntityByExternalId(input);
	if (!existing) {
		throw new Error("Could not persist or find global entity after conflict");
	}

	return { entity: existing, isNew: false };
};

export const updateGlobalEntityById = async (input: {
	name: string;
	entityId: string;
	populatedAt: Date;
	entitySchemaId: string;
	removePropertyKeys?: string[];
	image: ImageSchemaType | null;
	properties: Record<string, unknown>;
}) => {
	const propertiesBase = (input.removePropertyKeys ?? []).reduce(
		(acc, key) => sql`(${acc} - ${key})`,
		sql`${entity.properties}`,
	);

	const [updated] = await db
		.update(entity)
		.set({
			name: input.name,
			image: input.image,
			populatedAt: input.populatedAt,
			properties: sql`${propertiesBase} || ${JSON.stringify(input.properties)}::jsonb`,
		})
		.where(
			and(
				eq(entity.id, input.entityId),
				isNull(entity.userId),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		)
		.returning(entitySelection);

	if (!updated) {
		throw new Error(`Failed to update global entity '${input.entityId}'`);
	}

	return updated;
};

export const upsertEntityRelationship = async (input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
	properties: Record<string, unknown>;
}) => {
	await db
		.insert(relationship)
		.values({
			properties: input.properties,
			sourceEntityId: input.sourceEntityId,
			targetEntityId: input.targetEntityId,
			relationshipSchemaId: input.relationshipSchemaId,
		})
		.onConflictDoUpdate({
			set: { properties: input.properties },
			targetWhere: isNull(relationship.userId),
			target: [
				relationship.sourceEntityId,
				relationship.targetEntityId,
				relationship.relationshipSchemaId,
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

/**
 * Inserts a user-scoped relationship row. Silently skips if the row already exists
 * (ON CONFLICT DO NOTHING). Callers must not assume the write occurred on success.
 */
export const insertRelationship = async (input: {
	userId: string;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
	properties: Record<string, unknown>;
}) => {
	await db
		.insert(relationship)
		.values({
			userId: input.userId,
			properties: input.properties,
			sourceEntityId: input.sourceEntityId,
			targetEntityId: input.targetEntityId,
			relationshipSchemaId: input.relationshipSchemaId,
		})
		.onConflictDoNothing({
			target: [
				relationship.userId,
				relationship.sourceEntityId,
				relationship.targetEntityId,
				relationship.relationshipSchemaId,
			],
		});
};

export const upsertRelationship = async (
	input: {
		userId: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	},
	database: DbClient = db,
) => {
	const [savedRelationship] = await database
		.insert(relationship)
		.values({
			userId: input.userId,
			properties: input.properties,
			sourceEntityId: input.sourceEntityId,
			targetEntityId: input.targetEntityId,
			relationshipSchemaId: input.relationshipSchemaId,
		})
		.onConflictDoUpdate({
			set: { properties: input.properties },
			target: [
				relationship.userId,
				relationship.sourceEntityId,
				relationship.targetEntityId,
				relationship.relationshipSchemaId,
			],
		})
		.returning({ ...relationshipSelection, wasInserted: sql<boolean>`(xmax = '0'::xid)` });

	return assertPersisted(savedRelationship, "relationship");
};

export const deleteRelationship = async (input: {
	userId: string;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
}) => {
	const [deletedRelationship] = await db
		.delete(relationship)
		.where(
			and(
				eq(relationship.userId, input.userId),
				eq(relationship.sourceEntityId, input.sourceEntityId),
				eq(relationship.targetEntityId, input.targetEntityId),
				eq(relationship.relationshipSchemaId, input.relationshipSchemaId),
			),
		)
		.returning(relationshipSelection);

	return deletedRelationship;
};

export const upsertInLibraryRelationship = async (
	input: { userId: string; entityId: string; libraryEntityId: string },
	insert: typeof insertRelationship = insertRelationship,
) => {
	const found = await getBuiltinRelationshipSchemaBySlug("in-library");
	if (!found) {
		throw new Error("in-library relationship schema not found");
	}
	await insert({
		properties: {},
		userId: input.userId,
		relationshipSchemaId: found.id,
		sourceEntityId: input.entityId,
		targetEntityId: input.libraryEntityId,
	});
};
