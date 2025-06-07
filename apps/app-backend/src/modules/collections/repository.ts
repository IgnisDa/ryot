import { and, eq } from "drizzle-orm";
import { db } from "~/lib/db";
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
