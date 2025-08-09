import { and, desc, eq, isNull, or } from "drizzle-orm";

import { assertPersisted, type DbClient, db } from "~/lib/db";
import { entity, entitySchema, relationship } from "~/lib/db/schema";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";

import type { AddToCollectionData, CollectionResponse } from "./schemas";

const collectionSelection = {
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

type CollectionRow = Omit<CollectionResponse, "image" | "properties"> & {
	image: unknown;
	properties: unknown;
};

const toCollectionResponse = (row: CollectionRow): CollectionResponse => ({
	...row,
	image: row.image as CollectionResponse["image"],
	properties: row.properties as Record<string, unknown>,
});

export const getBuiltinCollectionSchema = async () => {
	const [foundEntitySchema] = await db
		.select({
			id: entitySchema.id,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(and(eq(entitySchema.slug, "collection"), eq(entitySchema.isBuiltin, true)))
		.limit(1);

	return foundEntitySchema;
};

export const createLibraryEntityForUser = async (
	input: { userId: string; entitySchemaId: string },
	database: DbClient = db,
) => {
	const [existing] = await database
		.select({ id: entity.id })
		.from(entity)
		.where(
			and(
				eq(entity.userId, input.userId),
				eq(entity.entitySchemaId, input.entitySchemaId),
				isNull(entity.externalId),
				isNull(entity.sandboxScriptId),
			),
		)
		.limit(1);

	if (existing) {
		return existing;
	}

	const [createdEntity] = await database
		.insert(entity)
		.values({
			image: null,
			properties: {},
			name: "Library",
			externalId: null,
			userId: input.userId,
			sandboxScriptId: null,
			entitySchemaId: input.entitySchemaId,
		})
		.returning({ id: entity.id });

	return assertPersisted(createdEntity, "library entity");
};

export const createCollectionForUser = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
}) => {
	const [createdEntity] = await db
		.insert(entity)
		.values({
			image: null,
			externalId: null,
			name: input.name,
			userId: input.userId,
			sandboxScriptId: null,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
		})
		.returning(collectionSelection);

	return toCollectionResponse(assertPersisted(createdEntity, "collection") as CollectionRow);
};

const membershipSelection = {
	id: relationship.id,
	createdAt: relationship.createdAt,
	properties: relationship.properties,
	sourceEntityId: relationship.sourceEntityId,
	targetEntityId: relationship.targetEntityId,
	relationshipSchemaId: relationship.relationshipSchemaId,
};

type MembershipRow = {
	id: string;
	createdAt: Date;
	properties: unknown;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
};

const toMembershipResponse = (row: MembershipRow): AddToCollectionData["memberOf"] => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	properties: row.properties as Record<string, unknown>,
});

export const getExistingMembership = async (
	input: { userId: string; entityId: string; collectionId: string },
	database: DbClient = db,
): Promise<AddToCollectionData | undefined> => {
	const found = await getBuiltinRelationshipSchemaBySlug("member-of");
	if (!found) {
		throw new Error("member-of relationship schema not found");
	}
	const memberOfSchemaId = found.id;

	const [memberOfRel] = (await database
		.select(membershipSelection)
		.from(relationship)
		.where(
			and(
				eq(relationship.userId, input.userId),
				eq(relationship.relationshipSchemaId, memberOfSchemaId),
				eq(relationship.sourceEntityId, input.entityId),
				eq(relationship.targetEntityId, input.collectionId),
			),
		)
		.orderBy(desc(relationship.createdAt))
		.limit(1)) as MembershipRow[];

	if (!memberOfRel) {
		return undefined;
	}

	return { memberOf: toMembershipResponse(memberOfRel) };
};

export const addEntityToCollection = async (input: {
	userId: string;
	entityId: string;
	collectionId: string;
	properties: Record<string, unknown>;
}): Promise<AddToCollectionData> => {
	const found = await getBuiltinRelationshipSchemaBySlug("member-of");
	if (!found) {
		throw new Error("member-of relationship schema not found");
	}
	const memberOfSchemaId = found.id;

	return db.transaction(async (tx) => {
		await tx
			.insert(relationship)
			.values({
				userId: input.userId,
				properties: input.properties,
				sourceEntityId: input.entityId,
				targetEntityId: input.collectionId,
				relationshipSchemaId: memberOfSchemaId,
			})
			.onConflictDoUpdate({
				set: { properties: input.properties },
				target: [
					relationship.userId,
					relationship.sourceEntityId,
					relationship.targetEntityId,
					relationship.relationshipSchemaId,
				],
			});

		const [memberOfRel] = (await tx
			.select(membershipSelection)
			.from(relationship)
			.where(
				and(
					eq(relationship.userId, input.userId),
					eq(relationship.relationshipSchemaId, memberOfSchemaId),
					eq(relationship.sourceEntityId, input.entityId),
					eq(relationship.targetEntityId, input.collectionId),
				),
			)
			.orderBy(desc(relationship.createdAt))
			.limit(1)) as MembershipRow[];

		if (!memberOfRel) {
			throw new Error("Could not add entity to collection");
		}

		return { memberOf: toMembershipResponse(memberOfRel) };
	});
};

export const getCollectionById = async (
	collectionId: string,
	userId: string,
): Promise<CollectionResponse | undefined> => {
	const [foundEntity] = await db
		.select(collectionSelection)
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.id, collectionId),
				eq(entity.userId, userId),
				eq(entitySchema.slug, "collection"),
				eq(entitySchema.isBuiltin, true),
			),
		)
		.limit(1);

	if (!foundEntity) {
		return undefined;
	}

	return toCollectionResponse(foundEntity as CollectionRow);
};

export const getEntityById = async (
	entityId: string,
	userId: string,
): Promise<{ id: string; userId: string | null } | undefined> => {
	const [foundEntity] = await db
		.select({ id: entity.id, userId: entity.userId })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.id, entityId),
				or(isNull(entity.userId), eq(entity.userId, userId)),
				or(isNull(entitySchema.userId), eq(entitySchema.userId, userId)),
			),
		)
		.limit(1);

	return foundEntity;
};

export const removeEntityFromCollection = async (input: {
	userId: string;
	entityId: string;
	collectionId: string;
}): Promise<AddToCollectionData | undefined> => {
	const found = await getBuiltinRelationshipSchemaBySlug("member-of");
	if (!found) {
		throw new Error("member-of relationship schema not found");
	}
	const memberOfSchemaId = found.id;

	const [deletedRel] = (await db
		.delete(relationship)
		.where(
			and(
				eq(relationship.userId, input.userId),
				eq(relationship.relationshipSchemaId, memberOfSchemaId),
				eq(relationship.sourceEntityId, input.entityId),
				eq(relationship.targetEntityId, input.collectionId),
			),
		)
		.returning(membershipSelection)) as MembershipRow[];

	if (!deletedRel) {
		return undefined;
	}

	return { memberOf: toMembershipResponse(deletedRel) };
};
