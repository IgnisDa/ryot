import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import {
	entity,
	entityAccessScopeWithSchemaJoinSelection,
	entitySchema,
	entitySchemaAccessScopeSelection,
	type ImageSchemaType,
	relationship,
} from "~/lib/db/schema";
import type { AddToCollectionData } from "~/modules/collections/schemas";
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
				eq(entity.userId, input.userId),
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
				eq(entity.userId, input.userId),
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
	properties: EntityPropertiesShape;
	sandboxScriptId?: string | null;
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

const membershipSelection = {
	id: relationship.id,
	relType: relationship.relType,
	createdAt: relationship.createdAt,
	sourceEntityId: relationship.sourceEntityId,
	targetEntityId: relationship.targetEntityId,
	properties: relationship.properties,
};

type MembershipRow = {
	id: string;
	relType: string;
	sourceEntityId: string;
	targetEntityId: string;
	createdAt: Date;
	properties: unknown;
};

const toMembershipResponse = (
	row: MembershipRow,
): AddToCollectionData["collection"] => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	properties: row.properties as Record<string, unknown>,
});

const toMembershipData = (
	relationships: MembershipRow[],
): AddToCollectionData | undefined => {
	const collectionRel = relationships.find(
		(row) => row.relType === "collection",
	);
	const memberOfRel = relationships.find((row) => row.relType === "member_of");

	if (!collectionRel || !memberOfRel) {
		return undefined;
	}

	return {
		memberOf: toMembershipResponse(memberOfRel),
		collection: toMembershipResponse(collectionRel),
	};
};

export const createEntityAndAddToCollection = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
	collectionId: string;
	externalId?: string | null;
	image: ImageSchemaType | null;
	properties: EntityPropertiesShape;
	sandboxScriptId?: string | null;
	membershipProperties?: Record<string, unknown>;
}): Promise<{ entity: ListedEntity; membership: AddToCollectionData }> => {
	return db.transaction(async (tx) => {
		// Create the entity
		const [createdEntity] = await tx
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

		// Create the collection relationship
		await tx
			.insert(relationship)
			.values({
				userId: input.userId,
				relType: "collection",
				properties: input.membershipProperties ?? {},
				targetEntityId: createdEntity.id,
				sourceEntityId: input.collectionId,
			})
			.onConflictDoUpdate({
				set: { properties: input.membershipProperties ?? {} },
				target: [
					relationship.userId,
					relationship.sourceEntityId,
					relationship.targetEntityId,
					relationship.relType,
				],
			});

		// Create the member_of relationship
		await tx
			.insert(relationship)
			.values({
				relType: "member_of",
				userId: input.userId,
				properties: input.membershipProperties ?? {},
				sourceEntityId: createdEntity.id,
				targetEntityId: input.collectionId,
			})
			.onConflictDoUpdate({
				set: { properties: input.membershipProperties ?? {} },
				target: [
					relationship.userId,
					relationship.sourceEntityId,
					relationship.targetEntityId,
					relationship.relType,
				],
			});

		// Fetch the created relationships
		const relationships = (await tx
			.select(membershipSelection)
			.from(relationship)
			.where(
				and(
					eq(relationship.userId, input.userId),
					or(
						and(
							eq(relationship.relType, "collection"),
							eq(relationship.sourceEntityId, input.collectionId),
							eq(relationship.targetEntityId, createdEntity.id),
						),
						and(
							eq(relationship.relType, "member_of"),
							eq(relationship.sourceEntityId, createdEntity.id),
							eq(relationship.targetEntityId, input.collectionId),
						),
					),
				),
			)
			.orderBy(relationship.relType)) as MembershipRow[];

		const membership = toMembershipData(relationships);
		if (!membership) {
			throw new Error("Could not add entity to collection");
		}

		return {
			entity: toListedEntity(createdEntity),
			membership,
		};
	});
};
