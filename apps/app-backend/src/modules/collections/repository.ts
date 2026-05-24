import { and, eq, isNull, or } from "drizzle-orm";

import { assertPersisted, type DbClient, db } from "~/lib/db";
import { entity, entitySchema } from "~/lib/db/schema";

import type { CollectionResponse } from "./schemas";

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
	image: CollectionResponse["image"];
	properties: Record<string, unknown>;
};

const toCollectionResponse = (row: CollectionRow): CollectionResponse => ({
	...row,
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

export const findCollectionByNameForUser = async (input: {
	name: string;
	userId: string;
	entitySchemaId: string;
}): Promise<CollectionResponse | undefined> => {
	const [found] = await db
		.select(collectionSelection)
		.from(entity)
		.where(
			and(
				eq(entity.name, input.name),
				eq(entity.userId, input.userId),
				isNull(entity.externalId),
				isNull(entity.sandboxScriptId),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		)
		.limit(1);

	if (!found) {
		return undefined;
	}

	return toCollectionResponse(found);
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

	return toCollectionResponse(assertPersisted(createdEntity, "collection"));
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

	return toCollectionResponse(foundEntity);
};

export const getEntityById = async (
	entityId: string,
	userId: string,
): Promise<{ id: string; userId: string | null; entitySchemaSlug: string } | undefined> => {
	const [foundEntity] = await db
		.select({ id: entity.id, userId: entity.userId, entitySchemaSlug: entitySchema.slug })
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
