import { and, eq } from "drizzle-orm";
import { db } from "~/lib/db";
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

export const addEntityToCollection = async (input: {
	collectionId: string;
	entityId: string;
	userId: string;
	properties: Record<string, unknown>;
}): Promise<AddToCollectionData> => {
	const [collectionRel, memberOfRel] = await db
		.insert(relationship)
		.values([
			{
				relType: "collection",
				sourceEntityId: input.collectionId,
				targetEntityId: input.entityId,
				userId: input.userId,
				properties: input.properties,
			},
			{
				relType: "member_of",
				sourceEntityId: input.entityId,
				targetEntityId: input.collectionId,
				userId: input.userId,
				properties: input.properties,
			},
		])
		.returning(membershipSelection);

	if (!collectionRel || !memberOfRel) {
		throw new Error("Could not add entity to collection");
	}

	return {
		collection: toMembershipResponse(collectionRel as MembershipRow),
		memberOf: toMembershipResponse(memberOfRel as MembershipRow),
	};
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
		.where(and(eq(entity.id, entityId), eq(entity.userId, userId)))
		.limit(1);

	return foundEntity;
};
