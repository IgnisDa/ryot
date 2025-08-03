import { and, desc, eq, isNull, or } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import { entity, entitySchema, relationship } from "~/lib/db/schema";
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
		.where(
			and(
				eq(entitySchema.slug, "collection"),
				eq(entitySchema.isBuiltin, true),
			),
		)
		.limit(1);

	return foundEntitySchema;
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

	if (!createdEntity) {
		throw new Error("Could not persist collection");
	}

	return toCollectionResponse(createdEntity as CollectionRow);
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
	createdAt: Date;
	properties: unknown;
	sourceEntityId: string;
	targetEntityId: string;
};

const toMembershipResponse = (
	row: MembershipRow,
): AddToCollectionData["memberOf"] => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	properties: row.properties as Record<string, unknown>,
});

const toLegacyMembershipResponse = (
	row: MembershipRow,
): AddToCollectionData["memberOf"] => ({
	...toMembershipResponse(row),
	relType: "member_of",
	sourceEntityId: row.targetEntityId,
	targetEntityId: row.sourceEntityId,
});

export const toMembershipData = (
	relationships: MembershipRow[],
): AddToCollectionData | undefined => {
	const collectionRel = relationships.find(
		(row) => row.relType === "collection",
	);
	const memberOfRel = relationships.find((row) => row.relType === "member_of");

	if (!memberOfRel && !collectionRel) {
		return undefined;
	}

	if (memberOfRel) {
		return { memberOf: toMembershipResponse(memberOfRel) };
	}

	if (!collectionRel) {
		return undefined;
	}

	return { memberOf: toLegacyMembershipResponse(collectionRel) };
};

export const getExistingMembership = async (
	input: { userId: string; entityId: string; collectionId: string },
	database: DbClient = db,
): Promise<AddToCollectionData | undefined> => {
	const relationships = (await database
		.select(membershipSelection)
		.from(relationship)
		.where(
			and(
				eq(relationship.userId, input.userId),
				eq(relationship.relType, "member_of"),
				eq(relationship.sourceEntityId, input.entityId),
				eq(relationship.targetEntityId, input.collectionId),
			),
		)
		.orderBy(desc(relationship.createdAt))) as MembershipRow[];

	return toMembershipData(relationships);
};

export const addEntityToCollection = async (input: {
	userId: string;
	entityId: string;
	collectionId: string;
	properties: Record<string, unknown>;
}): Promise<AddToCollectionData> => {
	return db.transaction(async (tx) => {
		await tx
			.delete(relationship)
			.where(
				and(
					eq(relationship.userId, input.userId),
					eq(relationship.relType, "collection"),
					eq(relationship.sourceEntityId, input.collectionId),
					eq(relationship.targetEntityId, input.entityId),
				),
			);

		await tx
			.insert(relationship)
			.values({
				relType: "member_of",
				userId: input.userId,
				properties: input.properties,
				sourceEntityId: input.entityId,
				targetEntityId: input.collectionId,
			})
			.onConflictDoUpdate({
				set: { properties: input.properties },
				target: [
					relationship.userId,
					relationship.sourceEntityId,
					relationship.targetEntityId,
					relationship.relType,
				],
			});

		const relationships = await getExistingMembership(input, tx);
		if (!relationships) {
			throw new Error("Could not add entity to collection");
		}

		return relationships;
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
): Promise<{ id: string } | undefined> => {
	const [foundEntity] = await db
		.select({ id: entity.id })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.id, entityId),
				eq(entity.userId, userId),
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
	const deletedRelationships = (await db
		.delete(relationship)
		.where(
			and(
				eq(relationship.userId, input.userId),
				or(
					and(
						eq(relationship.relType, "collection"),
						eq(relationship.sourceEntityId, input.collectionId),
						eq(relationship.targetEntityId, input.entityId),
					),
					and(
						eq(relationship.relType, "member_of"),
						eq(relationship.sourceEntityId, input.entityId),
						eq(relationship.targetEntityId, input.collectionId),
					),
				),
			),
		)
		.returning(membershipSelection)) as MembershipRow[];

	return toMembershipData(deletedRelationships);
};
